import {ReactElement} from "react";
import {StageBase, StageResponse, InitialData, Message} from "@chub-ai/stages-ts";
import {LoadResponse} from "@chub-ai/stages-ts/dist/types/load";

/***
 The type that this stage persists message-level state in.
 This is primarily for readability, and not enforced.

 @description This type is saved in the database after each message,
  which makes it ideal for storing things like positions and statuses,
  but not for things like history, which is best managed ephemerally
  in the internal state of the Stage class itself.
 ***/
type PlayerStats = {
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
    level: number;
    xp: number;
    inventory: string[];
    abilities: AbilityScores;
};

type AbilityScores = {
    str: number;
    dex: number;
    con: number;
    int: number;
    wis: number;
    cha: number;
};

type RollRequest = {
    ability: string;
    dc?: number;
    reason: string;
    forCompanion?: string;
};

type RollResult = {
    ability: string;
    dc?: number;
    reason: string;
    forCompanion?: string;
    raw: number;
    modifier: number;
    total: number;
    advantage: 'normal' | 'advantage' | 'disadvantage';
    success?: boolean;
};

type RollState =
    | {kind: 'idle'}
    | {kind: 'pending'; request: RollRequest}
    | {kind: 'resolved'; result: RollResult};

type Companion = {
    id: string;
    name: string;
    mood: string;
    moodImages: {[mood: string]: string};
    description?: string;
    isRoster: boolean;
    abilities?: AbilityScores;  // optional — text-only newcomers don't need them
};

type Location = {
    id: string;        // lowercase, no spaces (e.g. "tavern")
    name: string;      // display name (e.g. "The Drunken Griffon")
    image: string;     // image URL (or data URL)
    description?: string;
    isKnown: boolean;  // true if predefined; false if AI-introduced
};

type MessageStateType = {
    player: PlayerStats;
    activeCompanions: Companion[];
    currentLocation: Location;
    rollState: RollState;
};

/***
 The type of the stage-specific configuration of this stage.

 @description This is for things you want people to be able to configure,
  like background color.
 ***/
type ConfigType = any;

/***
 The type that this stage persists chat initialization state in.
 If there is any 'constant once initialized' static state unique to a chat,
 like procedurally generated terrain that is only created ONCE and ONLY ONCE per chat,
 it belongs here.
 ***/
type InitStateType = any;

/***
 The type that this stage persists dynamic chat-level state in.
 This is for any state information unique to a chat,
    that applies to ALL branches and paths such as clearing fog-of-war.
 It is usually unlikely you will need this, and if it is used for message-level
    data like player health then it will enter an inconsistent state whenever
    they change branches or jump nodes. Use MessageStateType for that.
 ***/
type ChatStateType = any;

/***
 A simple example class that implements the interfaces necessary for a Stage.
 If you want to rename it, be sure to modify App.js as well.
 @link https://github.com/CharHubAI/chub-stages-ts/blob/main/src/types/stage.ts
 ***/
// Set to true while developing in the test runner.
// MUST be false before deploying to Chub.
const DEV_MODE = true;
 export class Stage extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType> {

    /***
     A very simple example internal state. Can be anything.
     This is ephemeral in the sense that it isn't persisted to a database,
     but exists as long as the instance does, i.e., the chat page is open.
     ***/
    myInternalState: {[key: string]: any};

    constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
        /***
         This is the first thing called in the stage,
         to create an instance of it.
         The definition of InitialData is at @link https://github.com/CharHubAI/chub-stages-ts/blob/main/src/types/initial.ts
         Character at @link https://github.com/CharHubAI/chub-stages-ts/blob/main/src/types/character.ts
         User at @link https://github.com/CharHubAI/chub-stages-ts/blob/main/src/types/user.ts
         ***/
        super(data);
        const {
            characters,         // @type:  { [key: string]: Character }
            users,                  // @type:  { [key: string]: User}
            config,                                 //  @type:  ConfigType
            messageState,                           //  @type:  MessageStateType
            environment,                     // @type: Environment (which is a string)
            initState,                             // @type: null | InitStateType
            chatState                              // @type: null | ChatStateType
        } = data;
        // Predefined companion roster. To add a new companion later, add an entry here.
const companionRoster: {[id: string]: Companion} = {
    niri: {
        id: 'niri',
        name: 'Niri',
        mood: 'neutral',
        moodImages: {
            neutral: '/characters/Niri_Neutral.gif',
            happy: '/characters/Niri_Happy.gif',
            exhausted: '/characters/Niri_Exhausted.gif',
            flustered: '/characters/Niri_Flustered.gif',
            satisfied: '/characters/Niri_Satisfied.gif',
            embarrassed: '/characters/Niri_Embarrassed.gif',
            flirty: '/characters/Niri_Flirty.gif'
        },
        description: 'A Halcyne Mystic. Naive but loyal.',
        isRoster: true,
        abilities: {
            str: 9,
            dex: 11,
            con: 10,
            int: 14,
            wis: 16,
            cha: 13
        }
    }
};
const knownLocations: {[id: string]: Location} = {
    tavern: {
        id: 'tavern',
        name: 'The Drunken Griffon',
        image: '/Locations/loc_tavern.png',
        description: 'A warm, smoky tavern in the heart of town.',
        isKnown: true
    },
    forest: {
        id: 'forest',
        name: 'Whispering Woods',
        image: '/Locations/loc_forest.png',
        description: 'An ancient forest where the trees seem to murmur.',
        isKnown: true
    },
    road: {
        id: 'road',
        name: 'The King\'s Road',
        image: '/Locations/loc_road.png',
        description: 'A wide, well-traveled trade road.',
        isKnown: true
    }
};
const defaultPlayer: PlayerStats = {
    hp: 20,
    maxHp: 20,
    mp: 10,
    maxMp: 10,
    level: 1,
    xp: 0,
    inventory: ['Rusty sword', 'Leather armor', 'Healing potion'],
    abilities: {
        str: 12,
        dex: 14,
        con: 12,
        int: 10,
        wis: 13,
        cha: 11
    }
};        

// Niri starts in the party. To start with an empty party instead, set this to [].
const defaultActiveCompanions: Companion[] = [companionRoster.niri];

// Defensively merge saved player state with defaults — fills in any fields
// that didn't exist in older save states (e.g., abilities, when they were added).
const savedPlayer = messageState?.player;
const mergedPlayer: PlayerStats = savedPlayer
    ? {
        ...defaultPlayer,
        ...savedPlayer,
        abilities: {...defaultPlayer.abilities, ...(savedPlayer.abilities ?? {})}
    }
    : defaultPlayer;

// Same for companions — backfill abilities for any roster companions missing them.
const savedCompanions = messageState?.activeCompanions;
const mergedCompanions: Companion[] = savedCompanions
    ? savedCompanions.map(c => {
        if (!c.isRoster) return c;
        const fromRoster = companionRoster[c.id];
        if (!fromRoster) return c;
        return {
            ...fromRoster,
            ...c,
            abilities: c.abilities ?? fromRoster.abilities,
            moodImages: c.moodImages && Object.keys(c.moodImages).length > 0
                ? c.moodImages
                : fromRoster.moodImages
        };
    })
    : defaultActiveCompanions;

this.myInternalState = {
    player: mergedPlayer,
    activeCompanions: mergedCompanions,
    companionRoster: companionRoster,
    currentLocation: messageState?.currentLocation ?? knownLocations.tavern,
    knownLocations: knownLocations,
    rollState: (messageState?.rollState && typeof messageState.rollState === 'object' && 'kind' in messageState.rollState)
        ? messageState.rollState
        : {kind: 'idle'},
    numUsers: Object.keys(users).length,
    numChars: Object.keys(characters).length
};
    }

    async load(): Promise<Partial<LoadResponse<InitStateType, ChatStateType, MessageStateType>>> {
        /***
         This is called immediately after the constructor, in case there is some asynchronous code you need to
         run on instantiation.
         ***/
        return {
            /*** @type boolean @default null
             @description The 'success' boolean returned should be false IFF (if and only if), some condition is met that means
              the stage shouldn't be run at all and the iFrame can be closed/removed.
              For example, if a stage displays expressions and no characters have an expression pack,
              there is no reason to run the stage, so it would return false here. ***/
            success: true,
            /*** @type null | string @description an error message to show
             briefly at the top of the screen, if any. ***/
            error: null,
            initState: null,
            chatState: null,
        };
    }

    async setState(state: MessageStateType): Promise<void> {
        /***
         This can be called at any time, typically after a jump to a different place in the chat tree
         or a swipe. Note how neither InitState nor ChatState are given here. They are not for
         state that is affected by swiping.
         ***/
        if (state != null) {
            this.myInternalState = {...this.myInternalState, ...state};
        }
    }
    placeholderImage(name: string, mood: string, color: string): string {
    // Generates a colored SVG with the name and mood drawn on it,
    // returned as a data URL that can be used in <img src="...">.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160">
        <rect width="120" height="160" fill="${color}"/>
        <rect x="0" y="0" width="120" height="160" fill="none" stroke="#222" stroke-width="3"/>
        <text x="60" y="75" font-family="system-ui, sans-serif" font-size="18" font-weight="bold" text-anchor="middle" fill="#fff">${name}</text>
        <text x="60" y="100" font-family="system-ui, sans-serif" font-size="12" text-anchor="middle" fill="#fff" opacity="0.85">${mood}</text>
    </svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
formatModifier(score: number): string {
    const mod = Math.floor((score - 10) / 2);
    return mod >= 0 ? `+${mod}` : `${mod}`;
}

formatRollBlock(): string {
    const rs: RollState = this.myInternalState['rollState'];
    if (rs.kind === 'idle') return 'No active roll.';
    if (rs.kind === 'pending') {
        const r = rs.request;
        const dcStr = r.dc !== undefined ? ` (DC ${r.dc})` : '';
        const forStr = r.forCompanion ? ` for ${r.forCompanion}` : '';
        return `Awaiting player to resolve: ${r.ability.toUpperCase()}${dcStr}${forStr} — ${r.reason}. DO NOT request another roll. Wait for the result.`;
    }
    const r = rs.result;
    const dcStr = r.dc !== undefined ? ` vs DC ${r.dc}` : '';
    const succStr = r.success === true ? ' [SUCCESS]' : r.success === false ? ' [FAILURE]' : '';
    const advText = r.advantage === 'normal' ? '' : ` (${r.advantage})`;
    const forStr = r.forCompanion ? ` for ${r.forCompanion}` : '';
    return `Just resolved${forStr}: ${r.ability.toUpperCase()}${advText}${dcStr} — rolled ${r.raw} ${r.modifier >= 0 ? '+' : ''}${r.modifier} = ${r.total}${succStr}. Reason: ${r.reason}. Narrate the outcome based on this result; do not request a new roll for the same situation.`;
}

resolveRoll(advantage: 'normal' | 'advantage' | 'disadvantage'): void {
    const state: RollState = this.myInternalState['rollState'];
    if (state.kind !== 'pending') {
        return;
    }
    const req = state.request;

    let abilities: AbilityScores | undefined;
    if (req.forCompanion) {
        const companion = (this.myInternalState['activeCompanions'] as Companion[])
            .find(c => c.id === req.forCompanion);
        abilities = companion?.abilities;
    } else {
        abilities = this.myInternalState['player'].abilities;
    }

    if (!abilities || !(req.ability in abilities)) {
        console.warn(`Stage: cannot resolve roll — ability "${req.ability}" not found`);
        return;
    }

    const score = abilities[req.ability as keyof AbilityScores];
    const modifier = Math.floor((score - 10) / 2);

    const roll = (): number => Math.floor(Math.random() * 20) + 1;
    let raw: number;
    if (advantage === 'normal') raw = roll();
    else if (advantage === 'advantage') raw = Math.max(roll(), roll());
    else raw = Math.min(roll(), roll());

    const total = raw + modifier;
    const result: RollResult = {
        ability: req.ability,
        dc: req.dc,
        reason: req.reason,
        forCompanion: req.forCompanion,
        raw,
        modifier,
        total,
        advantage,
        success: req.dc !== undefined ? total >= req.dc : undefined
    };

    this.myInternalState['rollState'] = {kind: 'resolved', result};
}

freeRoll(ability: string, advantage: 'normal' | 'advantage' | 'disadvantage'): void {
    this.myInternalState['rollState'] = {
        kind: 'pending',
        request: {ability, reason: 'Player-declared check'}
    };
    this.resolveRoll(advantage);
}

parseRollRequest(content: string): RollRequest | null {
    const parts = content.split(',').map(s => s.trim()).filter(s => s.length > 0);
    const fields: {[key: string]: string} = {};
    for (const p of parts) {
        const eq = p.indexOf('=');
        if (eq < 0) continue;
        const key = p.substring(0, eq).trim().toLowerCase();
        const val = p.substring(eq + 1).trim();
        fields[key] = val;
    }
    if (!fields.ability) {
        console.warn('Stage: ROLL_REQUEST missing ability');
        return null;
    }
    const ability = fields.ability.toLowerCase();
    const validAbilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    if (!validAbilities.includes(ability)) {
        console.warn('Stage: ROLL_REQUEST has unknown ability:', ability);
        return null;
    }
    const req: RollRequest = {
        ability,
        reason: fields.reason || 'a check'
    };
    if (fields.dc) {
        const dc = parseInt(fields.dc, 10);
        if (!isNaN(dc)) req.dc = dc;
    }
    if (fields.for) {
        req.forCompanion = fields.for.toLowerCase();
    }
    return req;
}
locationPlaceholder(name: string, color1: string, color2: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
        <defs>
            <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${color1}"/>
                <stop offset="100%" stop-color="${color2}"/>
            </linearGradient>
        </defs>
        <rect width="320" height="180" fill="url(#g)"/>
        <rect x="0" y="0" width="320" height="180" fill="none" stroke="#222" stroke-width="3"/>
        <text x="160" y="100" font-family="system-ui, sans-serif" font-size="22" font-weight="bold" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="0.5">${name}</text>
    </svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
formatStatsForPrompt(): string {
    const player: PlayerStats = this.myInternalState['player'];
    const companions: Companion[] = this.myInternalState['activeCompanions'];
    const location: Location = this.myInternalState['currentLocation'];
    const knownLocations: {[id: string]: Location} = this.myInternalState['knownLocations'];
    const inv = player.inventory.length === 0 ? 'empty' : player.inventory.join(', ');

    const companionLines = companions.length === 0
        ? 'No active companions.'
        : companions.map(c => {
            const abilityStr = c.abilities
                ? ` | STR ${c.abilities.str} (${this.formatModifier(c.abilities.str)}), DEX ${c.abilities.dex} (${this.formatModifier(c.abilities.dex)}), CON ${c.abilities.con} (${this.formatModifier(c.abilities.con)}), INT ${c.abilities.int} (${this.formatModifier(c.abilities.int)}), WIS ${c.abilities.wis} (${this.formatModifier(c.abilities.wis)}), CHA ${c.abilities.cha} (${this.formatModifier(c.abilities.cha)})`
                : '';
            return `- ${c.name} (id: ${c.id}, mood: ${c.mood})${abilityStr}`;
        }).join('\n');

    const validMoods = ['neutral', 'happy', 'exhausted', 'flustered', 'satisfied', 'embarrassed', 'flirty'];
    const knownLocationLines = Object.values(knownLocations)
        .map(l => `- ${l.name} (id: ${l.id})`)
        .join('\n');

    return `[CURRENT PLAYER STATE]
HP: ${player.hp}/${player.maxHp}
MP: ${player.mp}/${player.maxMp}
Level: ${player.level}, XP: ${player.xp}
Inventory: ${inv}
Abilities: STR ${player.abilities.str} (${this.formatModifier(player.abilities.str)}), DEX ${player.abilities.dex} (${this.formatModifier(player.abilities.dex)}), CON ${player.abilities.con} (${this.formatModifier(player.abilities.con)}), INT ${player.abilities.int} (${this.formatModifier(player.abilities.int)}), WIS ${player.abilities.wis} (${this.formatModifier(player.abilities.wis)}), CHA ${player.abilities.cha} (${this.formatModifier(player.abilities.cha)})
[/CURRENT PLAYER STATE]

[ACTIVE COMPANIONS]
${companionLines}
[/ACTIVE COMPANIONS]

[CURRENT LOCATION]
${location.name} (id: ${location.id})
[/CURRENT LOCATION]

[KNOWN LOCATIONS]
${knownLocationLines}
[/KNOWN LOCATIONS]

[ROLL]
${this.formatRollBlock()}
[/ROLL]

You MUST end every response with a state update block in this exact format on its own line:
[STATE: hp=N, inventory+=ItemName, companion.id.mood=mood, companion+=Name, companion-=id, location=LocationNameOrId]

When the player attempts something with meaningful uncertainty, you may also include a roll request, on its own line:
[ROLL_REQUEST: ability=wis, dc=15, reason=spotting hidden tracks]

Roll request rules:
- ability is required: str, dex, con, int, wis, or cha (lowercase).
- dc is optional but recommended. Easy 10, medium 15, hard 20, very hard 25.
- reason is required: a short phrase explaining what the check is for.
- for=companion_id is optional: ask a companion to roll instead of the player.
- Maximum one [ROLL_REQUEST] per response. After requesting, end your narration on a moment of suspense — DO NOT preempt the outcome.
- Roll for things with stakes (combat, perception, persuasion, athletic feats, lore). Don't roll for trivial actions.

Player rules:
- Use = to set (hp=15), += to add (xp+=50), -= to subtract or remove (inventory-=Healing potion).
- Numeric fields: hp, maxHp, mp, maxMp, level, xp.
- Inventory: items are strings; remove by exact name match.

Companion rules:
- To change a roster companion's mood, use companion.<id>.mood=<mood>.
- Valid moods for Niri: ${validMoods.join(', ')}
- To add a companion: companion+=<Name>. To remove: companion-=<id or name>.

Location rules:
- To change location, use location=<id or display name>. If it matches a known location id or name, full details are used. Otherwise it's treated as a new unknown place.
- Only emit location= when the party actually moves to a new place. Don't emit it for stays.

Roll interpretation:
- The [ROLL] block above tells you the roll status.
- "No active roll" — fine to request one if appropriate, otherwise ignore.
- "Awaiting player to resolve..." — you already asked. Continue the scene with suspense, do NOT narrate an outcome, do NOT request another roll.
- "Just resolved..." — narrate the outcome and move the scene forward. Use these guidelines:
  * Natural 1 (raw): notable mishap regardless of total
  * Natural 20 (raw): notable success regardless of total
  * If a DC was set: [SUCCESS] meets/exceeds the bar; [FAILURE] falls short. Margins matter — beating DC by 10+ is a triumph; missing by 10+ is disastrous.
  * If no DC: total 1-5 poor, 6-10 middling with cost, 11-15 solid, 16-20 clean, 21+ exceptional.
  * Don't let dice override common sense. A natural 20 to lift a mountain still fails interestingly.

General rules:
- Only include fields that changed.
- If nothing changed, output [STATE: ] with nothing inside.
- - Do not invent fields beyond those listed.`;
}
            parseStateUpdate(text: string): {cleanedText: string, applied: boolean} {
    // First: strip and parse any roll request.
    const rollRegex = /\[ROLL_REQUEST:([^\]]*)\]/i;
    const rollMatch = text.match(rollRegex);
    let workingText = text;
    let appliedRoll = false;
    if (rollMatch) {
        const reqContent = rollMatch[1].trim();
        const parsed = this.parseRollRequest(reqContent);
        if (parsed) {
            this.myInternalState['rollState'] = {kind: 'pending', request: parsed};
            appliedRoll = true;
        }
        workingText = workingText.replace(rollRegex, '').trim();
    }

    // Then: find the state block in the (possibly stripped) text.
    const stateRegex = /\[STATE:([^\]]*)\]/i;
    const match = workingText.match(stateRegex);

    if (!match) {
        return {cleanedText: workingText, applied: appliedRoll};
    }

    const stateContent = match[1].trim();
    const cleanedText = workingText.replace(stateRegex, '').trim();

    // Empty state block means "nothing changed" — that's valid.
    if (stateContent === '') {
        return {cleanedText, applied: true};
    }

    const player: PlayerStats = {...this.myInternalState['player']};

    // Split on commas, but be lenient about whitespace.
    const updates = stateContent.split(',').map(s => s.trim()).filter(s => s.length > 0);

    for (const update of updates) {
    // Companion mood update: companion.<id>.mood=<mood>
    let m = update.match(/^companion\.(\w+)\.mood\s*=\s*(.+)$/i);
    if (m) {
        this.applyCompanionMood(m[1].toLowerCase(), m[2].trim().toLowerCase());
        continue;
    }
    // Companion add: companion+=<Name>
    m = update.match(/^companion\s*\+=\s*(.+)$/i);
    if (m) {
        this.applyCompanionAdd(m[1].trim());
        continue;
    }
// Companion remove: companion-=<id or name>
    m = update.match(/^companion\s*-=\s*(.+)$/i);
    if (m) {
        this.applyCompanionRemove(m[1].trim());
        continue;
    }
    // Location change: location=<id or display name>
    m = update.match(/^location\s*=\s*(.+)$/i);
    if (m) {
        this.applyLocationChange(m[1].trim());
        continue;
    }
    // Player += first (must come before = since it contains =)
    m = update.match(/^(\w+)\s*\+=\s*(.+)$/);
    if (m) {
        this.applyDelta(player, m[1], m[2], 'add');
        continue;
    }
    m = update.match(/^(\w+)\s*-=\s*(.+)$/);
    if (m) {
        this.applyDelta(player, m[1], m[2], 'subtract');
        continue;
    }
    m = update.match(/^(\w+)\s*=\s*(.+)$/);
    if (m) {
        this.applyDelta(player, m[1], m[2], 'set');
        continue;
    }
    // Unrecognized format — ignore quietly rather than crashing.
    console.warn('Stage: could not parse state update:', update);
}

    // Clamp HP/MP to valid ranges.
    player.hp = Math.max(0, Math.min(player.hp, player.maxHp));
    player.mp = Math.max(0, Math.min(player.mp, player.maxMp));

    this.myInternalState['player'] = player;
    return {cleanedText, applied: true};
}

applyDelta(player: PlayerStats, field: string, value: string, op: 'set' | 'add' | 'subtract'): void {
    const numericFields = ['hp', 'maxHp', 'mp', 'maxMp', 'level', 'xp'];

    if (field === 'inventory') {
        const itemName = value.trim();
        if (op === 'add' || op === 'set') {
            player.inventory = [...player.inventory, itemName];
        } else if (op === 'subtract') {
            const idx = player.inventory.findIndex(
                i => i.toLowerCase() === itemName.toLowerCase()
            );
            if (idx >= 0) {
                player.inventory = player.inventory.filter((_, i) => i !== idx);
            }
        }
        return;
    }

    if (!numericFields.includes(field)) {
        console.warn('Stage: unknown field:', field);
        return;
    }

    const num = parseInt(value, 10);
    if (isNaN(num)) {
        console.warn('Stage: non-numeric value for', field, ':', value);
        return;
    }

    const key = field as keyof PlayerStats;
    if (op === 'set') {
        (player[key] as number) = num;
    } else if (op === 'add') {
        (player[key] as number) = (player[key] as number) + num;
    } else if (op === 'subtract') {
        (player[key] as number) = (player[key] as number) - num;
    }
}
applyCompanionMood(id: string, mood: string): void {
    const companions: Companion[] = this.myInternalState['activeCompanions'];
    const target = companions.find(c => c.id === id);
    if (!target) {
        console.warn(`Stage: tried to set mood for unknown companion id "${id}"`);
        return;
    }
    if (!target.isRoster) {
        console.warn(`Stage: companion "${target.name}" is text-only, cannot change mood`);
        return;
    }
    if (!(mood in target.moodImages)) {
        console.warn(`Stage: mood "${mood}" not defined for ${target.name}`);
        return;
    }
    target.mood = mood;
    this.myInternalState['activeCompanions'] = [...companions];
}

applyCompanionAdd(nameOrId: string): void {
    const companions: Companion[] = this.myInternalState['activeCompanions'];
    const roster: {[id: string]: Companion} = this.myInternalState['companionRoster'];
    const lookupKey = nameOrId.toLowerCase();

    if (companions.some(c => c.id === lookupKey || c.name.toLowerCase() === lookupKey)) {
        console.warn(`Stage: companion "${nameOrId}" already in active party`);
        return;
    }

    if (lookupKey in roster) {
        const fromRoster = roster[lookupKey];
        const newCompanion: Companion = {
            ...fromRoster,
            mood: 'neutral',
            moodImages: {...fromRoster.moodImages}
        };
        this.myInternalState['activeCompanions'] = [...companions, newCompanion];
        return;
    }

    const newcomer: Companion = {
        id: nameOrId.toLowerCase().replace(/\s+/g, '_'),
        name: nameOrId,
        mood: 'unknown',
        moodImages: {},
        isRoster: false
    };
    this.myInternalState['activeCompanions'] = [...companions, newcomer];
}

applyCompanionRemove(nameOrId: string): void {
    const companions: Companion[] = this.myInternalState['activeCompanions'];
    const lookupKey = nameOrId.toLowerCase();
    const filtered = companions.filter(
        c => c.id !== lookupKey && c.name.toLowerCase() !== lookupKey
    );
    if (filtered.length === companions.length) {
        console.warn(`Stage: companion "${nameOrId}" not found in active party`);
        return;
    }
    this.myInternalState['activeCompanions'] = filtered;
}
applyLocationChange(nameOrId: string): void {
    const known: {[id: string]: Location} = this.myInternalState['knownLocations'];
    const lookupKey = nameOrId.toLowerCase();

    if (lookupKey in known) {
        this.myInternalState['currentLocation'] = known[lookupKey];
        return;
    }

    const byName = Object.values(known).find(
        l => l.name.toLowerCase() === lookupKey
    );
    if (byName) {
        this.myInternalState['currentLocation'] = byName;
        return;
    }

    this.myInternalState['currentLocation'] = {
        id: lookupKey.replace(/\s+/g, '_'),
        name: nameOrId,
        image: this.locationPlaceholder(nameOrId, '#555', '#222'),
        isKnown: false
    };
}
    async beforePrompt(userMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
        /***
         This is called after someone presses 'send', but before anything is sent to the LLM.
         ***/
        const {
            content,            /*** @type: string
             @description Just the last message about to be sent. ***/
            anonymizedId,       /*** @type: string
             @description An anonymized ID that is unique to this individual
              in this chat, but NOT their Chub ID. ***/
            isBot             /*** @type: boolean
             @description Whether this is itself from another bot, ex. in a group chat. ***/
} = userMessage;

        // Once the player sends a message after a resolved roll, clear it so it doesn't linger.
        const rs: RollState = this.myInternalState['rollState'];
        if (rs.kind === 'resolved') {
            this.myInternalState['rollState'] = {kind: 'idle'};
        }

        return {
            /*** @type null | string @description A string to add to the
             end of the final prompt sent to the LLM,
             but that isn't persisted. ***/

            stageDirections: this.formatStatsForPrompt(),
            /*** @type MessageStateType | null @description the new state after the userMessage. ***/
            messageState: {
                player: this.myInternalState['player'],
                activeCompanions: this.myInternalState['activeCompanions'],
                currentLocation: this.myInternalState['currentLocation'],
                rollState: this.myInternalState['rollState']
            },
            /*** @type null | string @description If not null, the user's message itself is replaced
             with this value, both in what's sent to the LLM and in the database. ***/
            modifiedMessage: null,
            /*** @type null | string @description A system message to append to the end of this message.
             This is unique in that it shows up in the chat log and is sent to the LLM in subsequent messages,
             but it's shown as coming from a system user and not any member of the chat. If you have things like
             computed stat blocks that you want to show in the log, but don't want the LLM to start trying to
             mimic/output them, they belong here. ***/
            systemMessage: null,
            /*** @type null | string @description an error message to show
             briefly at the top of the screen, if any. ***/
            error: null,
            chatState: null,
        };
    }

    async afterResponse(botMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
        /***
         This is called immediately after a response from the LLM.
         ***/
        const {
            content,            /*** @type: string
             @description The LLM's response. ***/
            anonymizedId,       /*** @type: string
             @description An anonymized ID that is unique to this individual
              in this chat, but NOT their Chub ID. ***/
            isBot             /*** @type: boolean
             @description Whether this is from a bot, conceivably always true. ***/
        } = botMessage;

        const {cleanedText, applied} = this.parseStateUpdate(content);

        return {
            /*** @type null | string @description A string to add to the
             end of the final prompt sent to the LLM,
             but that isn't persisted. ***/
            stageDirections: null,
            /*** @type MessageStateType | null @description the new state after the botMessage. ***/
            messageState: {
                player: this.myInternalState['player'],
                activeCompanions: this.myInternalState['activeCompanions'],
                currentLocation: this.myInternalState['currentLocation'],
                rollState: this.myInternalState['rollState']
            },
            /*** @type null | string @description If not null, the bot's response itself is replaced
             with this value, both in what's sent to the LLM subsequently and in the database. ***/
            modifiedMessage: applied ? cleanedText : null,
            /*** @type null | string @description an error message to show
             briefly at the top of the screen, if any. ***/
            error: null,
            systemMessage: null,
            chatState: null
        };
    }

render(): ReactElement {
    const player: PlayerStats = this.myInternalState['player'];

      return <div style={{
        width: '100%',
        minHeight: '100vh',
        padding: '12px',
        fontFamily: 'system-ui, sans-serif',
        color: '#e0e0e0',
        background: 'rgba(20, 20, 30, 0.85)',
        boxSizing: 'border-box',
        overflowY: 'auto'
    }}>
{(() => {
    const loc: Location = this.myInternalState['currentLocation'];
    return (
        <div style={{marginBottom: '12px'}}>
            <img
                src={loc.image}
                alt={loc.name}
                style={{
                    width: '100%',
                    maxHeight: '180px',
                    objectFit: 'cover',
                    borderRadius: '6px',
                    display: 'block'
                }}
            />
            <div style={{
                fontSize: '13px',
                fontWeight: 'bold',
                marginTop: '4px',
                color: loc.isKnown ? '#e0e0e0' : '#bbb',
                fontStyle: loc.isKnown ? 'normal' : 'italic'
            }}>
                {loc.name}
                {!loc.isKnown && <span style={{fontSize: '10px', marginLeft: '6px', color: '#888'}}>(uncharted)</span>}
            </div>
        </div>
    );
})()}

        <div style={{display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '8px'}}>
            <div>HP: <span style={{color: '#ff6b6b'}}>{player.hp}/{player.maxHp}</span></div>
            <div>MP: <span style={{color: '#6bb6ff'}}>{player.mp}/{player.maxMp}</span></div>
            <div>Lvl: <span style={{color: '#ffd56b'}}>{player.level}</span></div>
            <div>XP: {player.xp}</div>
        </div>

        <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: '6px',
            marginBottom: '12px',
            fontSize: '11px'
        }}>
            {[
                {label: 'STR', value: player.abilities.str},
                {label: 'DEX', value: player.abilities.dex},
                {label: 'CON', value: player.abilities.con},
                {label: 'INT', value: player.abilities.int},
                {label: 'WIS', value: player.abilities.wis},
                {label: 'CHA', value: player.abilities.cha}
            ].map(stat => (
                <div key={stat.label} style={{
                    background: 'rgba(0,0,0,0.3)',
                    borderRadius: '4px',
                    padding: '4px',
                    textAlign: 'center'
                }}>
                    <div style={{fontSize: '10px', color: '#aaa'}}>{stat.label}</div>
                    <div style={{fontSize: '14px', fontWeight: 'bold'}}>{this.formatModifier(stat.value)}</div>
                    <div style={{fontSize: '9px', color: '#777'}}>{stat.value}</div>
                </div>
            ))}
        </div>

        <div>
            <div style={{fontSize: '12px', color: '#aaa', marginBottom: '4px'}}>Inventory</div>
            {player.inventory.length === 0
                ? <div style={{fontStyle: 'italic', color: '#777'}}>(empty)</div>
                : <ul style={{margin: 0, paddingLeft: '20px'}}>
                    {player.inventory.map((item, i) => <li key={i}>{item}</li>)}
                </ul>}
        </div>
        {(() => {
            const rs: RollState = this.myInternalState['rollState'];
            const showFreeRoll: boolean = this.myInternalState['showFreeRoll'] ?? false;

            const refresh = () => {
                this.myInternalState = {...this.myInternalState};
                window.location.reload();
            };

            const baseBtn = {
                fontSize: '11px',
                padding: '4px 10px',
                cursor: 'pointer',
                background: '#2a2a2a',
                color: '#e0e0e0',
                border: '1px solid #444',
                borderRadius: '3px'
            };

            const sectionStyle = {
                marginTop: '12px',
                paddingTop: '8px',
                borderTop: '1px solid #444'
            };

            if (rs.kind === 'pending') {
                const r = rs.request;
                const dcStr = r.dc !== undefined ? ` (DC ${r.dc})` : '';
                const forStr = r.forCompanion ? ` — ${r.forCompanion}` : '';
                return (
                    <div style={sectionStyle}>
                        <div style={{fontSize: '12px', color: '#ffd56b', marginBottom: '4px'}}>
                            Roll requested: <strong>{r.ability.toUpperCase()}</strong>{dcStr}{forStr}
                        </div>
                        <div style={{fontSize: '11px', color: '#bbb', marginBottom: '8px', fontStyle: 'italic'}}>
                            {r.reason}
                        </div>
                        <div style={{display: 'flex', gap: '6px', flexWrap: 'wrap'}}>
                            <button style={baseBtn} onClick={() => { this.resolveRoll('normal'); refresh(); }}>Roll</button>
                            <button style={baseBtn} onClick={() => { this.resolveRoll('advantage'); refresh(); }}>w/ Adv</button>
                            <button style={baseBtn} onClick={() => { this.resolveRoll('disadvantage'); refresh(); }}>w/ Dis</button>
                        </div>
                    </div>
                );
            }

            if (rs.kind === 'resolved') {
                const r = rs.result;
                const isCrit = r.raw === 20;
                const isFumble = r.raw === 1;
                const totalColor = isCrit ? '#ffd56b' : isFumble ? '#ff6b6b' : '#e0e0e0';
                const dcStr = r.dc !== undefined ? ` vs DC ${r.dc}` : '';
                const succStr = r.success === true ? ' ✓' : r.success === false ? ' ✗' : '';
                const succColor = r.success === true ? '#aac46b' : r.success === false ? '#ff6b6b' : '#e0e0e0';
                const advText = r.advantage === 'normal' ? '' : ` (${r.advantage})`;
                return (
                    <div style={sectionStyle}>
                        <div style={{fontSize: '12px', color: '#aaa', marginBottom: '4px'}}>
                            Last roll: <strong>{r.ability.toUpperCase()}</strong>{advText}{dcStr}
                        </div>
                        <div style={{fontSize: '11px', color: '#bbb', marginBottom: '4px', fontStyle: 'italic'}}>
                            {r.reason}
                        </div>
                        <div style={{fontSize: '14px'}}>
                            {r.raw} {r.modifier >= 0 ? '+' : ''}{r.modifier} = <strong style={{color: totalColor}}>{r.total}</strong>
                            <span style={{color: succColor, marginLeft: '6px'}}>{succStr}</span>
                            {isCrit && <span style={{color: '#ffd56b', marginLeft: '6px'}}>★ Crit</span>}
                            {isFumble && <span style={{color: '#ff6b6b', marginLeft: '6px'}}>✗ Fumble</span>}
                        </div>
                        <div style={{fontSize: '10px', color: '#666', marginTop: '6px'}}>
                            (Send your next message — the GM will react.)
                        </div>
                    </div>
                );
            }

            return (
                <div style={sectionStyle}>
                    {!showFreeRoll ? (
                        <button
                            style={{...baseBtn, fontSize: '10px', padding: '3px 8px'}}
                            onClick={() => { this.myInternalState['showFreeRoll'] = true; refresh(); }}
                        >
                            Free roll…
                        </button>
                    ) : (
                        <div>
                            <div style={{fontSize: '11px', color: '#aaa', marginBottom: '4px'}}>Pick an ability:</div>
                            <div style={{display: 'flex', gap: '4px', flexWrap: 'wrap'}}>
                                {['str', 'dex', 'con', 'int', 'wis', 'cha'].map(ab => (
                                    <button
                                        key={ab}
                                        style={{...baseBtn, flex: '1'}}
                                        onClick={() => {
                                            this.freeRoll(ab, 'normal');
                                            this.myInternalState['showFreeRoll'] = false;
                                            refresh();
                                        }}
                                    >
                                        {ab.toUpperCase()}
                                    </button>
                                ))}
                            </div>
                            <button
                                style={{...baseBtn, fontSize: '10px', marginTop: '6px'}}
                                onClick={() => { this.myInternalState['showFreeRoll'] = false; refresh(); }}
                            >
                                Cancel
                            </button>
                        </div>
                    )}
                </div>
            );
        })()}
        <div style={{
    marginTop: '12px',
    borderTop: '1px solid #444',
    paddingTop: '8px'
}}>
    <div style={{fontSize: '12px', color: '#aaa', marginBottom: '8px'}}>Active Companions</div>
    {this.myInternalState['activeCompanions'].length === 0
        ? <div style={{fontStyle: 'italic', color: '#777'}}>(traveling alone)</div>
        : <div style={{display: 'flex', gap: '12px', flexWrap: 'wrap'}}>
            {(this.myInternalState['activeCompanions'] as Companion[]).map(c => (
                <div key={c.id} style={{textAlign: 'center', minWidth: '120px'}}>
                    {c.isRoster && c.moodImages[c.mood] ? (
                        <img
                            src={c.moodImages[c.mood]}
                            alt={`${c.name} (${c.mood})`}
                            style={{
                                width: '120px',
                                height: '160px',
                                objectFit: 'cover',
                                borderRadius: '6px',
                                display: 'block'
                            }}
                        />
                    ) : (
                        <div style={{
                            width: '120px',
                            height: '160px',
                            background: '#333',
                            borderRadius: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#888',
                            fontSize: '12px',
                            fontStyle: 'italic',
                            textAlign: 'center',
                            padding: '8px',
                            boxSizing: 'border-box'
                        }}>
                            (no portrait)
                        </div>
                    )}
                    <div style={{fontSize: '13px', marginTop: '4px', fontWeight: 'bold'}}>{c.name}</div>
                    <div style={{fontSize: '11px', color: '#aaa'}}>{c.mood}</div>
                </div>
            ))}
        </div>
    }
</div>
        {DEV_MODE && <div style={{marginTop: '12px', borderTop: '1px solid #444', paddingTop: '8px'}}>
    <div style={{fontSize: '11px', color: '#888', marginBottom: '4px'}}>Dev test</div>
    <button
        style={{fontSize: '11px', padding: '4px 8px', cursor: 'pointer'}}
        onClick={() => {
    // Cycle through several test scenarios on each click.
    const scenarios = [
        `She blushes at your compliment. [STATE: companion.niri.mood=flustered]`,
        `Niri yawns deeply, the day catching up to her. [STATE: companion.niri.mood=exhausted]`,
        `A mysterious stranger joins your party. [STATE: companion+=Hooded Figure]`,
        `The hooded figure vanishes into the night. [STATE: companion-=Hooded Figure]`,
        `You strike a goblin and find loot. [STATE: hp-=3, xp+=50, inventory+=Goblin tooth, companion.niri.mood=satisfied]`,
        `Niri parts ways for now. [STATE: companion-=niri]`,
        `Niri returns with renewed purpose. [STATE: companion+=Niri]`,
        `You step out of the tavern and into the woods. [STATE: location=forest]`,
        `The path leads you back to the road. [STATE: location=The King's Road]`,
        `You arrive at a strange ruin you've never seen before. [STATE: location=The Sunken Tower]`,
        `You return to the warmth of the tavern. [STATE: location=tavern]`,
        `A trapdoor creaks beneath your boot. You notice the give just in time. [ROLL_REQUEST: ability=dex, dc=14, reason=avoiding a triggered floor trap] [STATE: ]`
    ];
    const counter = (this.myInternalState['testCounter'] || 0) % scenarios.length;
    const fakeReply = scenarios[counter];
    this.myInternalState['testCounter'] = counter + 1;

    const result = this.parseStateUpdate(fakeReply);
    console.log('Scenario:', counter, '|', fakeReply);
    console.log('Cleaned text:', result.cleanedText);
    console.log('New state:', this.myInternalState);

    // Reload the page to pick up state changes in dev.
    window.location.reload();
}}
>
        Simulate combat
    </button>
</div>}
    </div>;
}

}
