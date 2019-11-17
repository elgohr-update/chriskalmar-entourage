import fs from 'fs';
import path from 'path';
import { renderFile } from './render';
import { parseYaml } from './yaml';
import { renderTemplateToFile } from './template';
import {
  createOrResetWorkVersionFolder,
  lockWorkVersionFolder,
  printTask,
  log,
  storeWorkVersionConfig,
} from './util';
import { executeScript } from './script';
import {
  processDockerTask,
  pullForDockerComposeFile,
  runDockerComposeFile,
} from './docker';
import { updateProxyConfig } from './proxy';
import { addWorkVersionConfig } from './registry';

export const runProfile = async (profile, params, version) => {
  let profileFilename;

  ['yaml', 'yml'].map(ext => {
    const filename = `${path.basename(
      process.env.PROFILES_PATH,
    )}/${profile}.${ext}`;

    if (fs.existsSync(filename)) {
      profileFilename = filename;
    }
  });

  if (!profileFilename) {
    throw new Error(`Profile '${profile}' not found`);
  }

  const templateParams = {
    ...params,
    __VERSION: version,
    __PROFILE: profile,
  };

  const renderedProfile = renderFile(profileFilename, templateParams);
  const profileYaml = parseYaml(renderedProfile);

  createOrResetWorkVersionFolder(version);

  const { renderTemplates, prepare, docker } = profileYaml;

  if (renderTemplates) {
    printTask('Rendering templates');

    if (renderTemplates.files) {
      renderTemplates.files.map(template => {
        const templateFilename = renderTemplates.sourcePath
          ? `${renderTemplates.sourcePath}/${template}`
          : template;

        const outputFilename = renderTemplates.targetPath
          ? `${renderTemplates.targetPath}/${template}`
          : template;

        const renderedTemplate = renderTemplateToFile(
          templateFilename,
          templateParams,
          version,
          outputFilename,
        );

        log(`✔ ${template}`);
      });
    }
  }

  if (prepare) {
    printTask(`Executing 'prepare'`);

    for (const command of prepare) {
      log(`\n${command}\n`);
      await executeScript(version, command, templateParams);
    }
  }

  printTask(`Executing 'docker'`);
  const portRegistry = await processDockerTask(version, docker, templateParams);

  printTask(`Storing work version config`);

  const versionConfig = {
    timestamp: new Date().getTime(),
    version,
    profile,
    params: params,
    ports: portRegistry,
  };

  storeWorkVersionConfig(version, versionConfig);
  addWorkVersionConfig(versionConfig);

  printTask('Pulling containers');
  await pullForDockerComposeFile(version, docker);

  printTask('Starting docker-compose');
  await runDockerComposeFile(version, docker);

  printTask('Updating proxy');
  updateProxyConfig();

  // lockWorkVersionFolder(version);

  return {};
};
