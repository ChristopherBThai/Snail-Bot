# Snail

Snail is a utility bot for the OwO Bot Support Discord server.

Snail is interaction-first. Normal workflows use application commands, context
commands, buttons, selects, and modals instead of prefix commands.

## Development

Snail is developed and deployed with Node.js 26.

1. Run `npm ci`.
2. Copy `.env.example` to `.env` and fill in the required values.
3. Set `CONFIG_NAME` to the name of a file in `src/config` without the `.json`
   extension.
4. Run `npm start`.

## Commands

- `npm start` starts Snail.
- `npm run migrate` runs the one-time production database migration.
- `npm run check` checks formatting with Prettier.
- `npm run check:fix` formats the project with Prettier.
