import { notification } from './render.js';

const CHECK_INTERVAL_MS = 4.5 * 60 * 1000;
const PRAY_COOLDOWN_MS = 5 * 60 * 1000;

export function createPrayCurseReminders({ repository, rest, log, getChannelId }) {
    const users = new Set();
    const cooldowns = new Map();
    let active = false;
    let checkIntervalId;

    return {
        activate,
        deactivate,
        toggle,
    };

    async function activate() {
        active = true;
        users.clear();
        const loadedUsers = await repository.loadPrayCurseReminderUsers();
        if (!active) return;

        for (const userId of loadedUsers) users.add(userId);

        log.debug('Loaded pray/curse reminder users', { users: users.size });
        await check(false).catch(logCheckFailure);
        if (!active) return;

        checkIntervalId = setInterval(() => check().catch(logCheckFailure), CHECK_INTERVAL_MS);
    }

    function deactivate() {
        active = false;
        clearInterval(checkIntervalId);
        checkIntervalId = undefined;

        for (const cooldown of cooldowns.values()) clearTimeout(cooldown.timer);
        cooldowns.clear();
        users.clear();
    }

    async function toggle(userId) {
        const enabled = !users.has(userId);
        await repository.savePrayCurseReminderEnabled(userId, enabled);

        if (enabled) {
            users.add(userId);
            await checkUsers([userId], false).catch(logCheckFailure);
        } else {
            users.delete(userId);
            clearCooldown(userId);
        }

        log.info(`${enabled ? 'Enabled' : 'Disabled'} pray/curse reminders`, { userId });
        return enabled;
    }

    async function check(remindIfAlreadyReady = true) {
        await checkUsers([...users], remindIfAlreadyReady);
    }

    async function checkUsers(userIds, remindIfAlreadyReady) {
        if (!active || !userIds.length) return;

        const timer = log.time();
        const results = await repository.getPrayCurseCooldowns(userIds);
        if (!active) return;

        let changed = 0;
        let scheduled = 0;
        let ready = 0;
        const now = Date.now();

        for (const [index, userId] of userIds.entries()) {
            if (!users.has(userId)) continue;

            const lasttime = results[index]?.lasttime;
            if (!lasttime) {
                clearCooldown(userId);
                continue;
            }

            const usedAt = Date.parse(lasttime);
            if (!Number.isFinite(usedAt)) {
                clearCooldown(userId);
                log.warn('Ignored invalid pray/curse cooldown timestamp', { userId, lasttime });
                continue;
            }

            const current = cooldowns.get(userId);
            if (current?.lasttime === lasttime) continue;

            clearCooldown(userId);
            changed += 1;
            const readyAt = usedAt + PRAY_COOLDOWN_MS;
            const cooldown = { lasttime, reminded: !remindIfAlreadyReady && readyAt <= now, timer: undefined };
            cooldowns.set(userId, cooldown);

            log.trace('Observed pray/curse cooldown', { userId, lasttime, readyAt });

            if (readyAt > now) {
                cooldown.timer = setTimeout(() => remind(userId, lasttime), readyAt - now);
                scheduled += 1;
            } else if (remindIfAlreadyReady) {
                // Recover a reminder first observed after it became ready because an earlier check was delayed or failed.
                // Redis only retains the latest successful use, so a newer use naturally supersedes an older reminder.
                ready += 1;
                await remind(userId, lasttime);
            }
        }

        timer.trace('Checked pray/curse reminders', {
            users: userIds.length,
            changed,
            scheduled,
            ready,
        });
    }

    async function remind(userId, lasttime) {
        const cooldown = cooldowns.get(userId);
        if (!active || !users.has(userId) || cooldown?.lasttime !== lasttime || cooldown.reminded) return;

        cooldown.timer = undefined;
        cooldown.reminded = true;
        const channelId = getChannelId();
        if (!channelId) {
            log.warn('Could not send pray/curse reminder without a Quest List channel', { userId });
            return;
        }

        try {
            await rest.sendMessage(channelId, notification(`<@${userId}>, you can pray or curse again!`, [userId]));
            log.info('Sent pray/curse reminder', { userId, channelId, lasttime });
        } catch (error) {
            log.error('Could not send pray/curse reminder', { error, userId, channelId, lasttime });
        }
    }

    function clearCooldown(userId) {
        clearTimeout(cooldowns.get(userId)?.timer);
        cooldowns.delete(userId);
    }

    function logCheckFailure(error) {
        log.error('Could not check pray/curse reminders', { error });
    }
}
