import { Harmony } from './deps.ts';
import { Tranquility } from './tq.ts';
import { config } from './config.ts';

const bot = new Harmony.Client({token: config.token, intents: Harmony.Intents.NonPrivileged});
const tq = new Tranquility(bot, 'src/modules', {guildId: config.guild, owners: config.owners});

bot.once('ready', async () => {
    await tq.onReady();
});

bot.connect();