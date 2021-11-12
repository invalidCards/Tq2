import { Tranquility, PrimitiveOptionType } from '../tq.ts';
import { Harmony } from '../deps.ts';

export function init(tq: Tranquility) {
    tq.registerCommand(
        Tranquility.newCommand('testcmd', 'This is a test command', handleTestCmd)
    );

    tq.client.on('threadCreate', onThreadCreate);
    tq.client.on('threadCreate', onThreadCreate2);
}

function handleTestCmd(i: Harmony.ApplicationCommandInteraction): Harmony.InteractionMessageOptions {
    return {content: `this is a reply! interaction id ${i.id} and also some more text and a little extra`, ephemeral: true};
}

function onThreadCreate(thread: Harmony.ThreadChannel) {
    console.log(`thread created named ${thread.name}`);
}

function onThreadCreate2(thread: Harmony.ThreadChannel) {
    console.log(`on thread create 2 with thread ${thread.name}`);
}