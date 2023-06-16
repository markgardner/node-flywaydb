#!/usr/bin/env node

'use strict';

const program = require('commander');
const pkg = require('../package.json');
const exeCommand = require('../lib/exec').exeCommand



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
        .action(exeCommand(program.configfile));
}
