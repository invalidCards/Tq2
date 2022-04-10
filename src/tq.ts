import { Harmony } from './deps.ts';
import { join } from 'https://deno.land/std@0.113.0/path/mod.ts'

export class Tranquility {
    private commandCache = new Harmony.Collection<string, SlashCommand>();
    private _client: Harmony.Client;
    private moduleDir: string;
    private guildId?: string;
    private owners?: string[];

    constructor(client: Harmony.Client, moduleDir: string, options?: TranquilityModuleOptions) {
        this._client = client;
        this.moduleDir = moduleDir;
        this.guildId = options?.guildId;
        this.owners = options?.owners;
    }

    get client() {
        return this._client;
    }

    /** Cache handlers and register things with Discord */
    async onReady() {
        const actualDir = join(Deno.cwd(), this.moduleDir);

        for await (const dirEntry of Deno.readDir(actualDir)) {
            if (!dirEntry.isFile) continue;
            if (!dirEntry.name.endsWith('.ts')) continue;

            const mod = await import(`file:///${join(actualDir, dirEntry.name)}?${crypto.randomUUID()}`);
            if (!isTranquilityModule(mod)) continue;

            mod.init(this);
        }

        this.initReloadCommand();
        await this.bulkEditSlashCommands(this.guildId);        

        this._client.on('interactionCreate', async (interaction) => {
            if (interaction.isApplicationCommand()) {
                if (interaction.data.type === Harmony.ApplicationCommandType.CHAT_INPUT) {
                    const command = this.commandCache.get(interaction.name);
                    if (!command) {
                        interaction.reply('Something went very wrong and the command is not registered. Please report this in the support server: <https://nvld.krd/support>', {ephemeral: true});
                        return;
                    }
                    
                    if (!command.dmAllowed && interaction.channel?.isDM()) {
                        interaction.reply('This command may not be used in DMs.');
                        return;
                    }
                    if (!this.checkCommandPermission(interaction, command)) return;

                    interaction.reply(await command.handler(interaction, this));
                } else {
                    //TODO: ctx
                    interaction.reply('not implemented');
                }
            } else if (interaction.isMessageComponent()) {
                const command = this.commandCache.get(interaction.customID.split('-')[0]);
                if (!command || !command.componentHandler) {
                    interaction.send('There is no handler registered for this component. Please report this in the support server: <https://nvld.krd/support>');
                    return;
                }

                await command.componentHandler(interaction, this);
            } else if (interaction.isAutocomplete()) {
                const command = this.commandCache.get(interaction.name);
                if (!command || !command.autocompleteHandler) {
                    return;
                }

                await command.autocompleteHandler(interaction, this);
            } else {
                //entirely unknown interaction type
                interaction.reply('You did something the bot doesn\'t know about! Please report this in the support server: <https://nvld.krd/support>');
            }
        });

        console.log(`Bot ready at ${new Date().toUTCString()}`);
    }

    /** Transform SlashCommands into ApplicationCommandPartials and register them with Discord */
    private async bulkEditSlashCommands(guildId?: string) {
        const registrationCache: Harmony.ApplicationCommandPartial[] = [];
        for (const cmd of this.commandCache.values()) {
            registrationCache.push(transformCommand(cmd));
        }
        await this._client.interactions.commands.bulkEdit(registrationCache, guildId);
    }

    /** Add a command to the bot */
    registerCommand(command: SlashCommand) {
        if (((command.groups && command.groups.length !== 0) || (command.subcommands && command.subcommands.length !== 0)) && (command.parameters && command.parameters.length !== 0)) {
            throw `Slash command ${command.name} - Both sublevels and parameters are defined directly under the slash command. This is not allowed!`;
        }

        this.commandCache.set(command.name, command);
    }

    /** Remove one or more commands from the bot by name. This should only be used if a module is hot-reloaded and a top-level command has been removed. */
    removeCommand(...commands: string[]) {
        commands.forEach(c => this.commandCache.delete(c));
    }

    /*
    registerContextCommand(name: string) {

    }
    */

    static newCommand(name: string, description: string, handler: SlashCommandHandler) {
        return new SlashCommand(name, description, handler);
    }

    static newComponent(interaction: Harmony.Interaction) {
        if (!interaction.isApplicationCommand()) return;
        return new ComponentDefinition(interaction.name);
    }

    //#region built-in commands
    private initReloadCommand() {
        this.registerCommand(
            Tranquility.newCommand('reload', 'Reload a module.', this.handleReload)
                        .addParameter('module', 'The module to reload', PrimitiveOptionType.STRING)
                        .setOwnerOnly()
        );
    }
    
    private async handleReload(i: Harmony.ApplicationCommandInteraction, tq: Tranquility): Promise<Harmony.InteractionMessageOptions> {
        const reqModule = i.option<string>('module');
        if (!reqModule) return {content: 'Did not pass module name', ephemeral: true};
    
        const actualDir = join(Deno.cwd(), tq.moduleDir);
    
        try {
            await Deno.lstat(`${join(actualDir, reqModule)}.ts`);
            await i.defer(true);
            const mod = await import(`file:///${join(actualDir, reqModule)}.ts?${crypto.randomUUID()}`);
            if (!isTranquilityModule(mod)) return {content: 'Requested module is not a valid Tranquility module', ephemeral: true};
    
            mod.init(tq);
            tq.bulkEditSlashCommands(tq.guildId);
            return {content: `Refreshed and re-initialised module \`${reqModule}\`!`, ephemeral: true};
        } catch(_e) {
            if (_e.name === 'NotFound') {
                return {content: `Could not find a module with the name \`${reqModule}\`.`, ephemeral: true};
            } else if (_e.name === 'DiscordAPIError') {
                return {content: `Discord API error: ${_e.message}`, ephemeral: true};
            } else {
                return {content: `Unspecified error ${_e.name}: ${_e.message}`, ephemeral: true};
            }
        }
    }

    private checkCommandPermission(interaction: Harmony.Interaction, command: SlashCommand): boolean {
        if (
            (command.permission === SlashCommandPermission.OWNER && !this.userIsOwner(interaction.user)) ||
            (command.permission === SlashCommandPermission.ADMINISTRATOR && !this.memberIsAdministrator(interaction.channel, interaction.member)) ||
            (command.permission === SlashCommandPermission.CUSTOM && !this.memberHasCustomPermission(command.customPermission?.bitfield, interaction.channel, interaction.member))
        ) {
            interaction.reply('You do not have permissions to execute this command.');
            return false;
        }
        return true;
    }

    private userIsOwner(user: Harmony.User) {
        return (this.owners && this.owners.includes(user.id));
    }

    private memberIsAdministrator(channel?: Harmony.Channel, member?: Harmony.Member) {
        if (!channel) return false;
        if (channel.isDM()) return true;
        if (!member) return false;
        if (this.userIsOwner(member.user)) return true;
        return (member.permissions.has(Harmony.PermissionFlags.ADMINISTRATOR));
    }

    private memberHasCustomPermission(bitfield?: bigint, channel?: Harmony.Channel, member?: Harmony.Member) {
        if (this.memberIsAdministrator(channel, member)) return true;
        if (!bitfield || !member) return false;
        return (member.permissions.has(bitfield, true));
    }
    //#endregion
}

//#region Tranquility module
interface TranquilityModule {
    init(tq: Tranquility): void
}

function isTranquilityModule(module: unknown): module is TranquilityModule {
    return (
        typeof module === 'object' &&
        module !== null &&
        Object.hasOwn(module, 'init') &&
        (module as TranquilityModule).init !== undefined
    );
}

interface TranquilityModuleOptions {
    guildId?: string,
    owners?: string[]
}
//#endregion

//#region Slash command classes & utility
export enum PrimitiveOptionType {
    STRING = 3,
    INTEGER = 4,
    BOOLEAN = 5,
    USER = 6,
    CHANNEL = 7,
    ROLE = 8,
    MENTIONABLE = 9,
    NUMBER = 10,
    ATTACHMENT = 11
}

enum SlashCommandPermission {
    EVERYONE,
    ADMINISTRATOR,
    OWNER,
    CUSTOM
}

interface SlashParameterOptions {
    required?: boolean,
    choices?: Harmony.ApplicationCommandChoice[],
    channelTypes?: Harmony.ChannelTypes[],
    range?: Range,
    autocomplete?: boolean
}

interface SubCommandCreator {
    subcommands?: SlashSubCommand<SubCommandCreator>[]
}

class SlashParameter {
    name = '';
    description = '';
    type: PrimitiveOptionType;
    required = true;
    choices?: Harmony.ApplicationCommandChoice[];
    channelTypes?: Harmony.ChannelTypes[];
    range?: Range;
    autocomplete = false;

    constructor(name: string, description: string, type: PrimitiveOptionType) {
        this.name = name;
        this.description = description;
        this.type = type;
    }
}

class SlashSubCommand<T extends SubCommandCreator> {
    name = '';
    description = '';
    parameters: SlashParameter[] = [];
    private parent: T;

    constructor(name: string, description: string, parent: T) {
        this.name = name;
        this.description = description;
        this.parent = parent;
    }

    addParameter(name: string, description: string, type: PrimitiveOptionType, options?: SlashParameterOptions) {
        const param = new SlashParameter(name, description, type);
        if (options) {
            if (options.required) param.required = options.required;
            param.choices = options.choices;
            param.channelTypes = options.channelTypes;
            param.range = options.range;
            if (options.autocomplete) param.autocomplete = options.autocomplete;
        }
        this.parameters.push(param);
        return this;
    }

    done() {
        if (!this.parent.subcommands) this.parent.subcommands = [];
        this.parent.subcommands.push(this);
        return this.parent;
    }
}

class SlashGroup implements SubCommandCreator {
    name = '';
    description = '';
    subcommands: SlashSubCommand<SlashGroup>[] = [];
    private parent: SlashCommand;

    constructor(name: string, description: string, parent: SlashCommand) {
        this.name = name;
        this.description = description;
        this.parent = parent;
    }

    addSubCommand(name: string, description: string) {
        return new SlashSubCommand(name, description, this);
    }

    done() {
        if (!this.parent.groups) this.parent.groups = [];
        this.parent.groups.push(this);
        return this.parent;
    }
}

class SlashCommand implements SubCommandCreator {
    name = '';
    description = '';
    handler: SlashCommandHandler;
    groups?: SlashGroup[];
    subcommands?: SlashSubCommand<SlashCommand>[];
    parameters?: SlashParameter[];
    permission = SlashCommandPermission.EVERYONE;
    customPermission?: Harmony.Permissions;
    dmAllowed = true;
    componentHandler?: ComponentHandler;
    autocompleteHandler?: AutocompleteHandler;

    constructor(name: string, description: string, handler: SlashCommandHandler) {
        this.name = name;
        this.description = description;
        this.handler = handler;
    }

    addGroup(name: string, description: string) {
        return new SlashGroup(name, description, this);
    }

    addSubCommand(name: string, description: string) {
        return new SlashSubCommand(name, description, this);
    }

    addParameter(name: string, description: string, type: PrimitiveOptionType, options?: SlashParameterOptions) {
        const param = new SlashParameter(name, description, type);
        if (options) {
            if (options.required) param.required = options.required;
            param.choices = options.choices;
            param.channelTypes = options.channelTypes;
            param.range = options.range;
            if (options.autocomplete) param.autocomplete = options.autocomplete;
        }
        if (!this.parameters) this.parameters = [];
        this.parameters.push(param);
        return this;
    }

    setAdminOnly() {
        this.permission = SlashCommandPermission.ADMINISTRATOR;
        return this;
    }

    setOwnerOnly() {
        this.permission = SlashCommandPermission.OWNER;
        return this;
    }

    setCustomPermission(permission: Harmony.Permissions) {
        this.permission = SlashCommandPermission.CUSTOM;
        this.customPermission = permission;
        return this;
    }

    disableDM() {
        this.dmAllowed = false;
        return this;
    }

    setComponentHandler(handler: ComponentHandler) {
        this.componentHandler = handler;
        return this;
    }

    setAutocompleteHandler(handler: AutocompleteHandler) {
        this.autocompleteHandler = handler;
        return this;
    }
}

function transformCommand(input: SlashCommand): Harmony.ApplicationCommandPartial {
    const cmd: Harmony.ApplicationCommandPartial = { name: input.name, description: input.description };
    if (input.groups) {
        for (const group of input.groups) {
            const cmdGroup: Harmony.ApplicationCommandOption = { name: group.name, description: group.description, type: Harmony.ApplicationCommandOptionType.SUB_COMMAND_GROUP };
            for (const subcmd of group.subcommands) {
                if (!cmdGroup.options) cmdGroup.options = [];
                cmdGroup.options.push(transformSubcommand(subcmd));
            }
            if (!cmd.options) cmd.options = [];
            cmd.options.push(cmdGroup);
        }
    }
    if (input.subcommands) {
        for (const subcmd of input.subcommands) {
            if (!cmd.options) cmd.options = [];
            cmd.options.push(transformSubcommand(subcmd));
        }
    }
    if (input.parameters) {
        for (const param of input.parameters) {
            if (!cmd.options) cmd.options = [];
            cmd.options.push(transformParameter(param));
        }
    }
    return cmd;
}

function transformSubcommand(input: SlashSubCommand<SubCommandCreator>): Harmony.ApplicationCommandOption {
    const cmdSubcmd: Harmony.ApplicationCommandOption = { name: input.name, description: input.description, type: Harmony.ApplicationCommandOptionType.SUB_COMMAND };
    for (const param of input.parameters) {
        if (!cmdSubcmd.options) cmdSubcmd.options = [];
        cmdSubcmd.options.push(transformParameter(param));
    }
    return cmdSubcmd;
}

function transformParameter(param: SlashParameter): Harmony.ApplicationCommandOption {
    return {
        name: param.name,
        description: param.description,
        type: param.type as unknown as Harmony.ApplicationCommandOptionType,
        required: param.required,
        choices: param.choices,
        channelTypes: param.channelTypes,
        minValue: param.range?.min,
        maxValue: param.range?.max,
        autocomplete: param.autocomplete
    };
}

type SlashCommandHandler = (i: Harmony.ApplicationCommandInteraction, tq: Tranquility) => Harmony.InteractionMessageOptions | Promise<Harmony.InteractionMessageOptions>;
type ComponentHandler = (i: Harmony.MessageComponentInteraction, tq: Tranquility) => Promise<Harmony.Message> | Promise<Harmony.MessageComponentInteraction>;
type AutocompleteHandler = (i: Harmony.AutocompleteInteraction, tq: Tranquility) => Harmony.ApplicationCommandChoice[] | Promise<Harmony.ApplicationCommandChoice[]>;
//#endregion

//#region Component classes & utility
class ButtonComponent {
    style: Harmony.ButtonStyle;
    action?: string;
    link?: string;
    label?: string;
    emoji?: Harmony.MessageComponentEmoji;

    constructor(action: string, options?: {style?: Harmony.ButtonStyle, label?: string, emoji?: Harmony.MessageComponentEmoji}) {
        options?.style ? this.action = action : this.link = action;
        this.style = options?.style ?? Harmony.ButtonStyle.LINK;
        this.label = options?.label;
        this.emoji = options?.emoji;
    }
}

class SelectComponent {
    id: string;
    choiceCount?: Range;
    choices?: Harmony.SelectComponentOption[];

    constructor(id: string, choices: Harmony.SelectComponentOption[], options?: {choiceCount?: Range}) {
        this.id = id;
        this.choices = choices;
        this.choiceCount = options?.choiceCount;
    }
}

class ActionRowComponent {
    buttonChildren?: ButtonComponent[];
    selectChild?: SelectComponent;
    parent: ComponentDefinition;

    constructor(parent: ComponentDefinition) {
        this.parent = parent;
    }

    addButton(action: string, style: Harmony.ButtonStyle, options?: {label?: string, emoji?: Harmony.MessageComponentEmoji}) {
        if (style === Harmony.ButtonStyle.LINK) {
            throw `addButton may not be used to register link buttons. Use addLinkButton instead. For command ${this.parent.command}, action ${action}`;
        }

        if (this.selectChild !== undefined) {
            throw `addButton for command ${this.parent.command} and action ${action} is not allowed since this action row already has a select component.`;
        }

        if (!this.buttonChildren) {
            this.buttonChildren = [];
        }

        this.buttonChildren.push(new ButtonComponent(action, {style: style, label: options?.label, emoji: options?.emoji}));
        return this;
    }

    addLinkButton(link: string, label?: string) {
        if (this.selectChild !== undefined) {
            throw `addLinkButton for command ${this.parent.command} to URL ${link} is not allowed since this action row already has a select component.`;
        }

        if (!this.buttonChildren) {
            this.buttonChildren = [];
        }

        this.buttonChildren.push(new ButtonComponent(link, {style: Harmony.ButtonStyle.LINK, label: label}));
        return this;
    }

    addSelect(id: string, choices: Harmony.SelectComponentOption[], options?: {choiceCount?: Range}) {
        if (this.buttonChildren !== undefined) {
            throw `addSelect for command ${this.parent.command} is not allowed since this action row already has a button component.`;
        }

        this.selectChild = new SelectComponent(id, choices, options);
        return this;
    }
}

class ComponentDefinition {
    rows: ActionRowComponent[] = [];
    command: string;

    constructor(command: string) {
        this.command = command;
    }

    addRow() {
        return new ActionRowComponent(this);
    }
}
//#endregion

//#region General utility
interface Range {
    min: number,
    max: number
}
//#endregion