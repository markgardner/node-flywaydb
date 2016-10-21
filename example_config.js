var env = process.env;

module.exports = {
	url: `jdbc:postgresql://${env.PGHOST}:${env.PGPORT}/${env.PGDATABASE}`,
	schemas: 'public',
	locations: 'filesystem:sql/migrations',
	user: env.PGUSER,
	password: env.PGPASSWORD,
	sqlMigrationSuffix: '.pgsql'
};