#!/usr/bin/env node

'use strict';

const program = require('commander');
const path = require('path');
const spawn = require('child_process').spawn;
const fs = require('fs');
const os = require('os');
const pkg = require('../package.json');
const download = require('../lib/download');

process.title = 'flyway';
program
    .version(pkg.version)
    .option('-c, --configfile <file>', 'A javascript or json file containing configuration.')
    .on('--help', function() {
        console.log('  See Flyway\'s configuration options at https://flywaydb.org/documentation/commandline/');
    });

makeCommand('migrate', 'Migrates the schema to the latest version. Flyway will create the metadata table automatically if it doesn\'t exist.');
makeCommand('clean', 'Drops all objects (tables, views, procedures, triggers, ...) in the configured schemas. The schemas are cleaned in the order specified by the schemas property.');
makeCommand('info', 'Prints the details and status information about all the migrations.');
makeCommand('validate', `Validate applied migrations against resolved ones (on the filesystem or classpath) to detect accidental changes that may prevent the schema(s) from being recreated exactly.

           Validation fails if
             - differences in migration names, types or checksums are found
             - versions have been applied that aren't resolved locally anymore
             - versions have been resolved that haven't been applied yet`);
makeCommand('baseline', 'Baselines an existing database, excluding all migrations up to and including baselineVersion.');
makeCommand('repair', `Repairs the Flyway metadata table. This will perform the following actions:

             - Remove any failed migrations on databases without DDL transactions
               (User objects left behind must still be cleaned up manually)
             - Correct wrong checksums`);

program.parse(process.argv);

function makeCommand(name, desc) {
    program
        .command(name)
        .description(desc)
        .action(exeCommand);
}

function configFlywayArgs(config) {
    const flywayArgs = config.flywayArgs || {};
    const flywayArgsKeys = Object.keys(flywayArgs);

    return flywayArgsKeys.map(function(key) {
        return `-${key}=${flywayArgs[key]}`;
    });
}

function binIsFile(path) {
    const stats = fs.statSync(path);

    return !!stats && stats.isFile();
}

function exeCommand(cmd) {
    if(!program.configfile) {
        throw new Error('Config file option is required');
    }

    var config = require(path.resolve(program.configfile));

    if (typeof config === 'function') {
        config = config();
    }

    download.ensureArtifacts(config, function(err, flywayBin) {
        const workingDir = process.cwd();

        if(err) {
            throw new Error(err);
        }

        // Ensure that the flywayBin is a file, helps with security risk of having
        // shell true in the spawn call below
        if (!binIsFile(flywayBin)) {
            throw new Error('Flyway bin was not found at "' + flywayBin + '"');
        }

        const args = configFlywayArgs(config)
            .concat([cmd._name]);

        // Fix problem with spaces on windows OS
        // https://github.com/nodejs/node/issues/7367
        const isWindowsAndHasSpace = !!(flywayBin.match(/\s/) && os.platform() === 'win32');
        const safeSpawnBin = isWindowsAndHasSpace ? '"' + flywayBin + '"' : flywayBin;

        const child = spawn(safeSpawnBin, args, {
            env: Object.assign({}, process.env, config.env),
            cwd: workingDir,
            stdio: 'inherit',
            windowsVerbatimArguments: true, // Super Weird, https://github.com/nodejs/node/issues/5060
            shell: isWindowsAndHasSpace,
        });

        child.on('close', code => {
            process.exit(code);
        });
    });
}
