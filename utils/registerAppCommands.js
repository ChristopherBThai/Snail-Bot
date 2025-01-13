require('dotenv').config();
const axios = require('axios');
const appCommands = require('./commands.json');

const url = `https://discord.com/api/v8/applications/${process.env.CLIENT_ID}/commands`;
const headers = {
    Authorization: `Bot ${process.env.BOT_TOKEN}`,
};

const newCommands = {};
const currCommands = {};
const uniqueCommands = {};

async function run() {
    await getCommands();

    for (let key in uniqueCommands) {
        if (isDiff(newCommands[key], currCommands[key])) {
            if (!newCommands[key]) {
                console.log(`Deleting command: ${key}`);
                await deleteCommand(currCommands[key].id);
            } else if (!currCommands[key]) {
                console.log(`Adding command: ${key}`);
                await addCommand(newCommands[key]);
            } else {
                console.log(`Editing command: ${key}`);
                await editCommand(newCommands[key], currCommands[key].id);
            }
        }
    }

    process.exit();
}

async function getCommands() {
    parseAppCommands(newCommands, appCommands);
    let result = await axios({
        method: 'GET',
        headers,
        url,
    });
    parseAppCommands(currCommands, result.data);
}

function parseAppCommands(dict, commands) {
    commands?.forEach((appCommand) => {
        if (!appCommand.type) {
            // Default to slash command
            appCommand.type = 1;
        }
        const key = getKey(appCommand);
        dict[key] = appCommand;
        uniqueCommands[key] = true;
    });
}

function getKey(command) {
    return `${command.name}-${command.type}`;
}

async function deleteCommand(commandId) {
    return axios({
        method: 'DELETE',
        headers,
        url: `${url}/${commandId}`,
    });
}

async function addCommand(command) {
    return axios({
        method: 'POST',
        headers,
        url,
        data: command,
    });
}

async function editCommand(command, commandId) {
    return axios({
        method: 'PATCH',
        headers,
        url: `${url}/${commandId}`,
        data: command,
    });
}

function isDiff(newCommand, currCommand) {
    if (typeof newCommand !== typeof currCommand) {
        return true;
    } else if (typeof newCommand !== 'object') {
        if (newCommand !== currCommand) {
            return true;
        }
    } else if (Array.isArray(newCommand)) {
        if (!Array.isArray(currCommand) || newCommand.length !== currCommand.length) {
            return true;
        } else {
            for (let i = 0; i < newCommand.length; i++) {
                if (isDiff(newCommand[i], currCommand[i])) {
                    return true;
                }
            }
        }
    } else {
        for (const key in newCommand) {
            if (isDiff(newCommand[key], currCommand[key])) {
                return true;
            }
        }
    }
    return false;
}

run();
