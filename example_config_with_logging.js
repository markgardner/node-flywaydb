var env = process.env;

module.exports = {
    javaOpts: [
        '-Djava.util.logging.config.file=./conf/logging.properties'
    ],
    url: `jdbc:postgresql://${env.PGHOST}:${env.PGPORT}/${env.PGDATABASE}`,
    schemas: 'public',
    locations: 'filesystem:sql/migrations',
    user: env.PGUSER,
    password: env.PGPASSWORD,
    sqlMigrationSuffix: '.pgsql'
};

/* example conf/logging.properties file contents:

handlers=java.util.logging.ConsoleHandler
java.util.logging.ConsoleHandler.level=FINEST
org.flywaydb.level=FINEST

*/
