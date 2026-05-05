import React, {ReactElement, useState, useEffect} from "react";
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
    seeds: number;
    maxSeeds: number;
    tome: string[];  // spell IDs the player has learned
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

type SocialUnlock = {
    bondLevel: number;     // 1-10, the level at which this unlock becomes available
    description: string;   // narrative hint shown to the AI when bond is >= this level
};

type TimePeriod = 'morning' | 'midday' | 'afternoon' | 'evening' | 'night' | 'late_night';

type TimeState = {
    day: number;           // 0+, increments when crossing late_night → morning
    period: TimePeriod;
};

// Periods in cycle order. Used to advance time and handle wrap-around.
const TIME_PERIODS: TimePeriod[] = ['morning', 'midday', 'afternoon', 'evening', 'night', 'late_night'];

type Spell = {
    id: string;              // globally unique, e.g. 'niri_healing_light'
    name: string;            // display name, e.g. 'Healing Light'
    description: string;     // what the spell does, narratively
    seedCost: number;        // seeds consumed per cast
    bondRequirement: number; // minimum companion bond level for this spell to unlock
    effectTags?: string[];   // optional tags like ['heal', 'utility'] — for AI matching
};

// State for an active spell-choice picker. Triggered when bond rises to a level
// at which one or more new spells become available for the player to learn.
type SpellChoice = {
    companionId: string;        // which companion is teaching
    bondLevel: number;          // bond level reached that triggered this
    candidates: Spell[];        // 3 random spells offered (or fewer if pool too small)
};

type Companion = {
    id: string;
    name: string;
    mood: string;
    moodImages: {[mood: string]: string};
    description?: string;
    isRoster: boolean;
    abilities?: AbilityScores;  // optional — text-only newcomers don't need them
    bondLevel?: number;         // 0-10; defaults to 0
    bondProgress?: number;      // points accumulated toward next level
    socialUnlocks?: SocialUnlock[];  // narrative beats keyed to bond level
    spellList?: Spell[];        // spells this companion knows; used for bond-up picker
};

// Cumulative cost to reach each bond level. Index 0 = cost to reach level 1.
// Total to max bond (10): 144 points.
const BOND_LEVEL_COSTS: number[] = [5, 6, 8, 9, 11, 14, 17, 20, 24, 30];

// Helper: compute max seeds for a given player level. Base 5 + 1 per level.
const computeMaxSeeds = (level: number): number => 5 + Math.max(1, level);

// Bond event types and the points they award. The AI selects from this list
// when emitting [BOND: ...] tags. Progress-only — no events reduce bond.
const BOND_EVENT_VALUES: {[event: string]: number} = {
    personal_moment: 1,    // sharing a meal, quiet conversation, asking about their past
    quest_assist: 1,       // companion was meaningfully helpful toward a player goal
    defending: 2,          // taking a hit, standing up for them, prioritizing their safety
    personal_sacrifice: 2  // giving them something valuable, sharing reward to favor them
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
    spellChoice?: SpellChoice | null;
    timeState?: TimeState;
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
const DEV_MODE = false;
 export class Stage extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType> {

    /***
     A very simple example internal state. Can be anything.
     This is ephemeral in the sense that it isn't persisted to a database,
     but exists as long as the instance does, i.e., the chat page is open.
     ***/
    myInternalState: {[key: string]: any};
    // A simple counter that increments on every change. The wrapper
    // component watches this to know when to re-render.
    private renderVersion: number = 0;
    private renderListeners: Set<() => void> = new Set();

    private bumpVersion(): void {
        this.renderVersion++;
        this.renderListeners.forEach(fn => fn());
    }

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
        },
        bondLevel: 0,
        bondProgress: 0,
        socialUnlocks: [
            // Fill these in later. Example shape:
            // { bondLevel: 2, description: "Niri shares the name of her home village." },
            // { bondLevel: 4, description: "Niri starts using a private nickname for the player." }
        ],
        spellList: [
            // Fill these in later. Example shape:
            // {
            //     id: 'niri_healing_light',
            //     name: 'Healing Light',
            //     description: 'A pulse of pale-blue motes that mends minor wounds.',
            //     seedCost: 1,
            //     bondRequirement: 0,
            //     effectTags: ['heal']
            // },
            // {
            //     id: 'niri_warding_breath',
            //     name: 'Warding Breath',
            //     description: 'A whispered prayer that briefly steadies an ally against fear.',
            //     seedCost: 1,
            //     bondRequirement: 2,
            //     effectTags: ['utility', 'social']
            // }
        ]
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
    },
    seeds: 6,    // base 5 + level 1
    maxSeeds: 6,
    tome: []     // empty grimoire to start
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
        abilities: {...defaultPlayer.abilities, ...(savedPlayer.abilities ?? {})},
        // Backfill seed fields. If they're missing, scale to current level.
        maxSeeds: savedPlayer.maxSeeds ?? computeMaxSeeds(savedPlayer.level ?? 1),
        seeds: savedPlayer.seeds ?? computeMaxSeeds(savedPlayer.level ?? 1),
        tome: savedPlayer.tome ?? []
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
                : fromRoster.moodImages,
            bondLevel: c.bondLevel ?? 0,
            bondProgress: c.bondProgress ?? 0,
            socialUnlocks: c.socialUnlocks ?? fromRoster.socialUnlocks ?? [],
            // Always pull spellList from the current roster definition. Spells are
            // designer data, not save data — we want the live definition.
            spellList: fromRoster.spellList ?? []
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
    spellChoice: messageState?.spellChoice ?? null,
    timeState: (messageState?.timeState && typeof messageState.timeState === 'object' && 'period' in messageState.timeState)
        ? messageState.timeState
        : {day: 0, period: 'morning'},
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
        if (state == null) return;

        // Defensive merge: incoming state may be from an older save without
        // newer fields (abilities, seeds, tome, bond, etc). Backfill anything missing
        // so render code doesn't crash on undefined.
        const currentPlayer: PlayerStats = this.myInternalState['player'];
        const incomingPlayer = state.player;
        const mergedPlayer: PlayerStats = incomingPlayer
            ? {
                ...currentPlayer,
                ...incomingPlayer,
                abilities: {
                    ...(currentPlayer.abilities),
                    ...(incomingPlayer.abilities ?? {})
                },
                seeds: incomingPlayer.seeds ?? currentPlayer.seeds,
                maxSeeds: incomingPlayer.maxSeeds ?? currentPlayer.maxSeeds,
                tome: incomingPlayer.tome ?? currentPlayer.tome ?? []
            }
            : currentPlayer;

        const roster: {[id: string]: Companion} = this.myInternalState['companionRoster'];
        const incomingCompanions = state.activeCompanions;
        const mergedCompanions: Companion[] = incomingCompanions
            ? incomingCompanions.map(c => {
                if (!c.isRoster) return c;
                const fromRoster = roster[c.id];
                if (!fromRoster) return c;
                return {
                    ...fromRoster,
                    ...c,
                    abilities: c.abilities ?? fromRoster.abilities,
                    moodImages: c.moodImages && Object.keys(c.moodImages).length > 0
                        ? c.moodImages
                        : fromRoster.moodImages,
                    bondLevel: c.bondLevel ?? 0,
                    bondProgress: c.bondProgress ?? 0,
                    socialUnlocks: c.socialUnlocks ?? fromRoster.socialUnlocks ?? [],
                    spellList: fromRoster.spellList ?? []
                };
            })
            : (this.myInternalState['activeCompanions'] as Companion[]);

        this.myInternalState = {
            ...this.myInternalState,
            player: mergedPlayer,
            activeCompanions: mergedCompanions,
            currentLocation: state.currentLocation ?? this.myInternalState['currentLocation'],
            rollState: (state.rollState && typeof state.rollState === 'object' && 'kind' in state.rollState)
                ? state.rollState
                : this.myInternalState['rollState'],
            spellChoice: state.spellChoice ?? null,
            timeState: (state.timeState && typeof state.timeState === 'object' && 'period' in state.timeState)
                ? state.timeState
                : this.myInternalState['timeState'] ?? {day: 0, period: 'morning'}
        };

        this.bumpVersion();
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

    // Build a lookup of all spells available across active companions, for tome display.
    const allSpells: {[id: string]: {spell: Spell; teacherName: string}} = {};
    for (const c of companions) {
        if (!c.spellList) continue;
        for (const s of c.spellList) {
            allSpells[s.id] = {spell: s, teacherName: c.name};
        }
    }
    // The tome: spells the player has learned. Look up by id.
    const tomeIds = player.tome ?? [];
    const tomeLines = tomeIds.length === 0
        ? '(empty — no spells learned yet)'
        : tomeIds.map(id => {
            const entry = allSpells[id];
            if (!entry) return `- ${id} (unknown — teacher not in party?)`;
            const s = entry.spell;
            return `- ${s.name} (id: ${s.id}, cost: ${s.seedCost}, taught by ${entry.teacherName}): ${s.description}`;
        }).join('\n');

    // For each companion, list which of their spells are available to *them* given current bond.
    // (Important: companions cast from their own list, regardless of player tome.)
    const companionSpellLines = companions
        .filter(c => c.isRoster && c.spellList && c.spellList.length > 0)
        .map(c => {
            const available = (c.spellList ?? []).filter(s => s.bondRequirement <= (c.bondLevel ?? 0));
            if (available.length === 0) return `- ${c.name}: (none yet)`;
            const list = available.map(s => `${s.name} (cost: ${s.seedCost})`).join(', ');
            return `- ${c.name}: ${list}`;
        }).join('\n');

    const companionLines = companions.length === 0
        ? 'No active companions.'
        : companions.map(c => {
            const abilityStr = c.abilities
                ? ` | STR ${c.abilities.str} (${this.formatModifier(c.abilities.str)}), DEX ${c.abilities.dex} (${this.formatModifier(c.abilities.dex)}), CON ${c.abilities.con} (${this.formatModifier(c.abilities.con)}), INT ${c.abilities.int} (${this.formatModifier(c.abilities.int)}), WIS ${c.abilities.wis} (${this.formatModifier(c.abilities.wis)}), CHA ${c.abilities.cha} (${this.formatModifier(c.abilities.cha)})`
                : '';
            const bondStr = c.isRoster
                ? ` | bond: ${c.bondLevel ?? 0}/10 (${c.bondProgress ?? 0}/${BOND_LEVEL_COSTS[c.bondLevel ?? 0] ?? '—'})`
                : '';
            // Filter unlocks to ones the companion has reached.
            const unlocks = (c.socialUnlocks ?? []).filter(u => u.bondLevel <= (c.bondLevel ?? 0));
            const unlocksStr = unlocks.length > 0
                ? `\n  Unlocked beats: ${unlocks.map(u => `(L${u.bondLevel}) ${u.description}`).join('; ')}`
                : '';
            return `- ${c.name} (id: ${c.id}, mood: ${c.mood})${abilityStr}${bondStr}${unlocksStr}`;
        }).join('\n');

    const validMoods = ['neutral', 'happy', 'exhausted', 'flustered', 'satisfied', 'embarrassed', 'flirty'];
    const knownLocationLines = Object.values(knownLocations)
        .map(l => `- ${l.name} (id: ${l.id})`)
        .join('\n');

    return `[CURRENT PLAYER STATE]
HP: ${player.hp}/${player.maxHp}
MP: ${player.mp}/${player.maxMp}
Seeds: ${player.seeds}/${player.maxSeeds}
Level: ${player.level}, XP: ${player.xp}
Inventory: ${inv}
Abilities: STR ${player.abilities.str} (${this.formatModifier(player.abilities.str)}), DEX ${player.abilities.dex} (${this.formatModifier(player.abilities.dex)}), CON ${player.abilities.con} (${this.formatModifier(player.abilities.con)}), INT ${player.abilities.int} (${this.formatModifier(player.abilities.int)}), WIS ${player.abilities.wis} (${this.formatModifier(player.abilities.wis)}), CHA ${player.abilities.cha} (${this.formatModifier(player.abilities.cha)})
[/CURRENT PLAYER STATE]

[ACTIVE COMPANIONS]
${companionLines}
[/ACTIVE COMPANIONS]

[TOME — spells the player has learned, available for their companions to cast]
${tomeLines}
[/TOME]

[COMPANION SPELL ACCESS — spells each companion has unlocked at their current bond]
${companionSpellLines || '(none yet)'}
[/COMPANION SPELL ACCESS]

[CURRENT LOCATION]
${location.name} (id: ${location.id})
[/CURRENT LOCATION]

[CURRENT TIME]
Day ${(this.myInternalState['timeState'] as TimeState).day}, ${(this.myInternalState['timeState'] as TimeState).period.replace('_', ' ')}
[/CURRENT TIME]

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

Bond rules:
- Bond is per-companion, 0-10. It only goes up, never down.
- Award bond on its own line via: [BOND: <id>+=<amount>, reason=<event>]
- Valid events and their amounts:
  * personal_moment (+1): sharing a meal, quiet conversation, asking about their past
  * quest_assist (+1): companion was meaningfully helpful toward a player goal
  * defending (+2): player took a hit for them, stood up for them, prioritized their safety
  * personal_sacrifice (+2): player gave them something valuable, shared a reward in their favor
- Award bond sparingly. One bond event per response, at most. Only emit when a meaningful moment actually occurred — not for every kind word.
- Do NOT award bond for casual greetings, mundane interactions, or doing things companions would do anyway.
- Award the lower amount when in doubt; the system rewards consistent care over time.
- When a companion has unlocked social beats (shown in the ACTIVE COMPANIONS block), naturally weave them into your narration — share the detail, use the nickname, etc. The unlock is permission, not obligation; let it happen organically.

Seed rules:
- Seeds are a player resource that companions consume to cast their spells. They are shown in the player state.
- Companions cannot cast spells if the player's seeds are 0. Don't have a companion attempt magic when seeds=0.
- When a companion casts a spell, deduct the cost via [STATE: seeds-=N] in your response.
- Seeds replenish only on long rest. Don't restore them through other means (potions, items, etc.) unless explicitly part of player inventory or scene logic.
- Companions cannot share or transfer seeds between each other. Once consumed, the seed is gone until rest.

Spell casting rules:
- Companions cast their own spells; the player does not cast directly.
- A companion can ONLY cast a spell that appears in their COMPANION SPELL ACCESS list above. Do not invent spells, repurpose other companions' spells, or cast a spell the companion hasn't unlocked through bond.
- The TOME shows which spells the player has learned through bond growth. The tome is descriptive: it tracks the player's relationship-built knowledge. A companion can still cast their own unlocked spells regardless of tome, but the tome reflects the magical bond between player and companion.
- When a companion casts: narrate the moment in-character (the gesture, the visual, the cost), then deduct seeds via [STATE: seeds-=N] where N matches the spell's seed cost.
- If the player asks a companion to cast something not in COMPANION SPELL ACCESS, narrate the companion struggling, declining, or admitting they don't know it. Don't pretend they can.
- If the player asks for a spell when seeds=0, the companion cannot comply. Narrate the strain, the empty satchel, the moment of helplessness — turn it into character.
- Don't have companions cast unprompted in trivial moments. Save magic for stakes.

Long rest rules:
- A long rest occurs when the party rests in a safe location — an inn, a defensible camp, sanctuary. It's a full night's recovery.
- When the narrative reaches a clear long rest moment, declare it on its own line: [LONG_REST]
- A long rest restores HP, MP, and seeds to maximum. Don't include those individual stat changes in [STATE: ] — the rest tag handles them.
- Don't spam long rests. They're a meaningful pause, not a casual recovery. If the player asks to rest somewhere unsafe or hostile, you may decline narratively.
- The player can also trigger a long rest via the UI; you'll see seeds/HP/MP refilled when that happens.

Time rules:
- Time tracks day number (starting day 0) and period: morning, midday, afternoon, evening, night, late_night.
- Use the time naturally to color narration. "Sunlight slants across the floor" at midday, "the tavern's lanterns are lit" at evening, "the road is empty under starlight" at late night.
- Advance time on its own line via tags:
  * [TIME: advance=N] — move forward N period steps (1-3 typical). 
  * [TIME: set=<period>] — jump directly to a named period (wraps to next day if backward).
- Pacing guidelines (use as needed, not strict math):
  * Short scene, one conversation, one quick action: usually no advance.
  * Travel between nearby locations or a longer scene: advance=1.
  * Travel across distance, extended exploration, eventful chapter: advance=2 or more.
  * Reaching a destination "by evening" or similar: use [TIME: set=evening].
- Long rest (handled by [LONG_REST]) automatically advances to next morning. Don't combine [LONG_REST] with [TIME: ...] tags.
- Don't advance time on every message. The clock should match what the narration earned.

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

    // Strip and apply any long rest tags. Format: [LONG_REST]
    const restRegex = /\[LONG_REST\]/gi;
    let appliedRest = false;
    if (restRegex.test(workingText)) {
        this.longRest();
        workingText = workingText.replace(restRegex, '').trim();
        appliedRest = true;
    }

    // Strip and apply any time tags. Formats:
    //   [TIME: advance=N]   — advance N period steps
    //   [TIME: set=evening] — jump to that period (advances day if backward)
    const timeRegex = /\[TIME:([^\]]*)\]/gi;
    let timeMatch: RegExpExecArray | null;
    let appliedTime = false;
    const timeMatches: string[] = [];
    while ((timeMatch = timeRegex.exec(workingText)) !== null) {
        timeMatches.push(timeMatch[0]);
        const content = timeMatch[1].trim();
        const advanceMatch = content.match(/^advance\s*=\s*(\d+)$/i);
        if (advanceMatch) {
            const steps = parseInt(advanceMatch[1], 10);
            if (!isNaN(steps) && steps > 0) {
                this.advanceTimeBySteps(steps);
                appliedTime = true;
            }
            continue;
        }
        const setMatch = content.match(/^set\s*=\s*(\w+)$/i);
        if (setMatch) {
            const target = setMatch[1].toLowerCase() as TimePeriod;
            this.setTimePeriod(target);
            appliedTime = true;
            continue;
        }
        console.warn('Stage: malformed TIME tag:', content);
    }
    for (const tag of timeMatches) {
        workingText = workingText.replace(tag, '').trim();
    }

    // Strip and apply any bond tags. Format: [BOND: niri+=1, reason=quest_assist]
    // Multiple companions can be in one tag, comma-separated.
    const bondRegex = /\[BOND:([^\]]*)\]/gi;
    let bondMatch: RegExpExecArray | null;
    let appliedBond = false;
    const bondMatches: string[] = [];
    while ((bondMatch = bondRegex.exec(workingText)) !== null) {
        bondMatches.push(bondMatch[0]);
        const bondContent = bondMatch[1].trim();
        const parts = bondContent.split(',').map(s => s.trim()).filter(s => s.length > 0);
        // Parse fields. We expect exactly one companion+=N and exactly one reason=...
        let companionId: string | null = null;
        let amount: number = 0;
        let reason: string = '';
        for (const p of parts) {
            const addMatch = p.match(/^(\w+)\s*\+=\s*(\d+)$/);
            if (addMatch) {
                companionId = addMatch[1].toLowerCase();
                amount = parseInt(addMatch[2], 10);
                continue;
            }
            const reasonMatch = p.match(/^reason\s*=\s*(.+)$/i);
            if (reasonMatch) {
                reason = reasonMatch[1].trim().toLowerCase();
                continue;
            }
        }
        if (companionId && amount > 0) {
            // Validate reason against allowed event values; if unknown, still apply but warn.
            if (!(reason in BOND_EVENT_VALUES)) {
                console.warn(`Stage: unknown bond reason "${reason}", applying anyway`);
            }
            this.applyBondProgress(companionId, amount, reason);
            appliedBond = true;
        } else {
            console.warn('Stage: malformed BOND tag:', bondContent);
        }
    }
    // Strip all bond tags from working text after processing.
    for (const tag of bondMatches) {
        workingText = workingText.replace(tag, '').trim();
    }

    // Then: find the state block in the (possibly stripped) text.
    const stateRegex = /\[STATE:([^\]]*)\]/i;
    const match = workingText.match(stateRegex);

    if (!match) {
        return {cleanedText: workingText, applied: appliedRoll || appliedBond || appliedRest || appliedTime};
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

    // Clamp HP/MP/seeds to valid ranges.
    player.hp = Math.max(0, Math.min(player.hp, player.maxHp));
    player.mp = Math.max(0, Math.min(player.mp, player.maxMp));
    player.seeds = Math.max(0, Math.min(player.seeds, player.maxSeeds));

    // If level changed and the player's maxSeeds wasn't explicitly set this turn, scale it.
    // We detect this by comparing to what level-based max would be.
    const expectedMax = computeMaxSeeds(player.level);
    if (player.maxSeeds < expectedMax) {
        // Level went up — grant the new max as a small surprise refill.
        const gain = expectedMax - player.maxSeeds;
        player.maxSeeds = expectedMax;
        player.seeds = Math.min(player.maxSeeds, player.seeds + gain);
    }

    this.myInternalState['player'] = player;
    return {cleanedText, applied: true};
}

applyDelta(player: PlayerStats, field: string, value: string, op: 'set' | 'add' | 'subtract'): void {
    const numericFields = ['hp', 'maxHp', 'mp', 'maxMp', 'level', 'xp', 'seeds', 'maxSeeds'];

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

applyBondProgress(id: string, amount: number, reason: string): void {
    const companions: Companion[] = this.myInternalState['activeCompanions'];
    const target = companions.find(c => c.id === id);
    if (!target) {
        console.warn(`Stage: tried to add bond for unknown companion "${id}"`);
        return;
    }
    if (!target.isRoster) {
        console.warn(`Stage: companion "${target.name}" is text-only, no bond tracking`);
        return;
    }
    if (amount <= 0) {
        console.warn(`Stage: bond progress must be positive (got ${amount})`);
        return;
    }

    const currentLevel = target.bondLevel ?? 0;
    let progress = (target.bondProgress ?? 0) + amount;
    let level = currentLevel;

    // Level up if progress meets or exceeds the cost to next level.
    while (level < BOND_LEVEL_COSTS.length && progress >= BOND_LEVEL_COSTS[level]) {
        progress -= BOND_LEVEL_COSTS[level];
        level++;
    }

    const leveledUp = level > currentLevel;
    target.bondLevel = level;
    target.bondProgress = progress;
    console.log(`Stage: ${target.name} +${amount} bond (${reason}). Now level ${level}, ${progress}/${BOND_LEVEL_COSTS[level] ?? '—'} to next.`);
    this.myInternalState['activeCompanions'] = [...companions];

    // On level-up, offer the player a spell choice if any are available at the new level.
    if (leveledUp) {
        this.offerSpellChoice(target);
    }
}

// Build a SpellChoice for this companion if there are any unlearned spells
// at or below their new bond level. Up to 3 are presented at random.
offerSpellChoice(companion: Companion): void {
    if (!companion.spellList || companion.spellList.length === 0) return;
    const player: PlayerStats = this.myInternalState['player'];
    const learned = new Set(player.tome ?? []);

    const eligible = companion.spellList.filter(
        s => s.bondRequirement <= (companion.bondLevel ?? 0) && !learned.has(s.id)
    );
    if (eligible.length === 0) {
        console.log(`Stage: ${companion.name} bond up, but no new spells available.`);
        return;
    }

    // Shuffle (Fisher-Yates) and take up to 3.
    const shuffled = [...eligible];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const candidates = shuffled.slice(0, 3);

    this.myInternalState['spellChoice'] = {
        companionId: companion.id,
        bondLevel: companion.bondLevel ?? 0,
        candidates
    };
    console.log(`Stage: spell choice from ${companion.name} (${candidates.length} candidate${candidates.length === 1 ? '' : 's'}).`);
}

// Player picks one of the offered spells. Adds to tome, clears the choice.
chooseSpell(spellId: string): void {
    const choice: SpellChoice | null = this.myInternalState['spellChoice'];
    if (!choice) return;
    const spell = choice.candidates.find(s => s.id === spellId);
    if (!spell) {
        console.warn(`Stage: chose spell "${spellId}" not in current candidates`);
        return;
    }
    const player: PlayerStats = {...this.myInternalState['player']};
    player.tome = [...(player.tome ?? []), spell.id];
    this.myInternalState['player'] = player;
    this.myInternalState['spellChoice'] = null;
    console.log(`Stage: learned spell "${spell.name}" (${spell.id}).`);
}

// Player declines all candidates — choice cleared without learning anything.
// Spells may reappear next level-up if still eligible.
dismissSpellChoice(): void {
    this.myInternalState['spellChoice'] = null;
    console.log('Stage: spell choice dismissed.');
}

longRest(): void {
    const player: PlayerStats = {...this.myInternalState['player']};
    const beforeSeeds = player.seeds;
    const beforeHp = player.hp;
    const beforeMp = player.mp;
    player.seeds = player.maxSeeds;
    player.hp = player.maxHp;
    player.mp = player.maxMp;
    this.myInternalState['player'] = player;
    // Long rest advances to morning of the next day.
    const ts: TimeState = this.myInternalState['timeState'];
    this.myInternalState['timeState'] = {day: ts.day + 1, period: 'morning'};
    console.log(`Stage: long rest. Seeds ${beforeSeeds}→${player.seeds}, HP ${beforeHp}→${player.hp}, MP ${beforeMp}→${player.mp}. Time → Day ${ts.day + 1}, morning.`);
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

// Advance time by N period steps. Handles wrap-around to next day.
advanceTimeBySteps(steps: number): void {
    const ts: TimeState = this.myInternalState['timeState'];
    let dayDelta = 0;
    let idx = TIME_PERIODS.indexOf(ts.period);
    if (idx < 0) idx = 0;
    idx += steps;
    while (idx >= TIME_PERIODS.length) {
        idx -= TIME_PERIODS.length;
        dayDelta++;
    }
    while (idx < 0) {
        // We don't expect negative steps, but guard anyway.
        idx += TIME_PERIODS.length;
        dayDelta--;
    }
    const newPeriod = TIME_PERIODS[idx];
    const newDay = Math.max(0, ts.day + dayDelta);
    this.myInternalState['timeState'] = {day: newDay, period: newPeriod};
    console.log(`Stage: time advanced ${steps} step(s) → Day ${newDay}, ${newPeriod}.`);
}

// Set time to a specific period. If the target period is earlier than current
// (wraps backward), advance to the next day.
setTimePeriod(targetPeriod: TimePeriod): void {
    const ts: TimeState = this.myInternalState['timeState'];
    const currentIdx = TIME_PERIODS.indexOf(ts.period);
    const targetIdx = TIME_PERIODS.indexOf(targetPeriod);
    if (targetIdx < 0) {
        console.warn(`Stage: unknown time period "${targetPeriod}"`);
        return;
    }
    let newDay = ts.day;
    if (targetIdx < currentIdx) {
        // Wrap to next day.
        newDay++;
    }
    this.myInternalState['timeState'] = {day: newDay, period: targetPeriod};
    console.log(`Stage: time set → Day ${newDay}, ${targetPeriod}.`);
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

        // Clear resolved rolls only after the AI has had a chance to see them.
        // We use a "seen" flag stored alongside rollState to track this.
        const rs: RollState = this.myInternalState['rollState'];
        if (rs.kind === 'resolved') {
            if (this.myInternalState['rollSeen']) {
                this.myInternalState['rollState'] = {kind: 'idle'};
                this.myInternalState['rollSeen'] = false;
            } else {
                this.myInternalState['rollSeen'] = true;
            }
        } else {
            this.myInternalState['rollSeen'] = false;
        }

        // Notify any subscribed views to re-render with the new state.
        this.bumpVersion();

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
                rollState: this.myInternalState['rollState'],
                spellChoice: this.myInternalState['spellChoice']
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

        // Notify any subscribed views to re-render with the new state.
        this.bumpVersion();

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
                rollState: this.myInternalState['rollState'],
                spellChoice: this.myInternalState['spellChoice']
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
    // The class itself returns this small wrapper. The wrapper subscribes
    // to renderVersion bumps from the class so React properly re-renders
    // when buttons are clicked. All the actual rendering logic happens
    // inside StageView.
    const stage = this;
    const StageView = (): ReactElement => {
        const [, setVersion] = useState(stage.renderVersion);
        useEffect(() => {
            const listener = () => setVersion(stage.renderVersion);
            stage.renderListeners.add(listener);
            return () => { stage.renderListeners.delete(listener); };
        }, []);
        return stage.renderInner();
    };
    return <StageView />;
}

renderInner(): ReactElement {
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
            {(() => {
                const ts: TimeState = this.myInternalState['timeState'];
                return (
                    <div style={{fontSize: '11px', color: '#999', marginTop: '2px'}}>
                        Day {ts.day} · {ts.period.replace('_', ' ')}
                    </div>
                );
            })()}
        </div>
    );
})()}

        <div style={{display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '8px'}}>
            <div>HP: <span style={{color: '#ff6b6b'}}>{player.hp}/{player.maxHp}</span></div>
            <div>MP: <span style={{color: '#6bb6ff'}}>{player.mp}/{player.maxMp}</span></div>
            <div>Lvl: <span style={{color: '#ffd56b'}}>{player.level}</span></div>
            <div>XP: {player.xp}</div>
            <div>Seeds: <span style={{color: '#aac46b'}}>{player.seeds}/{player.maxSeeds}</span></div>
        </div>

        <div style={{marginBottom: '8px'}}>
            <button
                style={{
                    fontSize: '11px',
                    padding: '4px 10px',
                    cursor: 'pointer',
                    background: '#2a3a2a',
                    color: '#e0e0e0',
                    border: '1px solid #4a5a4a',
                    borderRadius: '3px'
                }}
                onClick={() => { this.longRest(); this.bumpVersion(); }}
                title="Restore HP, MP, and seeds to maximum."
            >
                Long rest
            </button>
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
            // Tome panel — shows learned spells with details.
            const tome = player.tome ?? [];
            const companions = this.myInternalState['activeCompanions'] as Companion[];
            const lookup: {[id: string]: {spell: Spell; teacherName: string}} = {};
            for (const c of companions) {
                if (!c.spellList) continue;
                for (const s of c.spellList) {
                    lookup[s.id] = {spell: s, teacherName: c.name};
                }
            }
            return (
                <div style={{marginTop: '12px'}}>
                    <div style={{fontSize: '12px', color: '#aaa', marginBottom: '4px'}}>Tome</div>
                    {tome.length === 0
                        ? <div style={{fontStyle: 'italic', color: '#777'}}>(empty)</div>
                        : <ul style={{margin: 0, paddingLeft: '20px', fontSize: '12px'}}>
                            {tome.map(id => {
                                const entry = lookup[id];
                                if (!entry) return <li key={id} style={{color: '#666'}}>{id} (unknown)</li>;
                                return (
                                    <li key={id} title={entry.spell.description}>
                                        <strong>{entry.spell.name}</strong>{' '}
                                        <span style={{fontSize: '10px', color: '#888'}}>
                                            ({entry.spell.seedCost} seed{entry.spell.seedCost === 1 ? '' : 's'}, {entry.teacherName})
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>}
                </div>
            );
        })()}

        {(() => {
            // Spell choice picker — shown only when a bond level-up just offered new spells.
            const choice: SpellChoice | null = this.myInternalState['spellChoice'];
            if (!choice) return null;
            const teacher = (this.myInternalState['activeCompanions'] as Companion[])
                .find(c => c.id === choice.companionId);
            const teacherName = teacher?.name ?? choice.companionId;
            return (
                <div style={{
                    marginTop: '12px',
                    padding: '8px',
                    border: '1px solid #7aaeff',
                    borderRadius: '6px',
                    background: 'rgba(40, 60, 90, 0.4)'
                }}>
                    <div style={{fontSize: '13px', fontWeight: 'bold', color: '#ffd56b', marginBottom: '4px'}}>
                        {teacherName} bond {choice.bondLevel} reached
                    </div>
                    <div style={{fontSize: '11px', color: '#bbb', marginBottom: '8px', fontStyle: 'italic'}}>
                        Choose one spell to add to your tome:
                    </div>
                    <div style={{display: 'flex', flexDirection: 'column', gap: '6px'}}>
                        {choice.candidates.map(spell => (
                            <button
                                key={spell.id}
                                style={{
                                    textAlign: 'left',
                                    padding: '6px 8px',
                                    cursor: 'pointer',
                                    background: '#2a2a2a',
                                    color: '#e0e0e0',
                                    border: '1px solid #555',
                                    borderRadius: '3px',
                                    fontSize: '11px'
                                }}
                                onClick={() => { this.chooseSpell(spell.id); this.bumpVersion(); }}
                            >
                                <div style={{fontWeight: 'bold'}}>
                                    {spell.name}{' '}
                                    <span style={{color: '#888', fontWeight: 'normal'}}>
                                        ({spell.seedCost} seed{spell.seedCost === 1 ? '' : 's'})
                                    </span>
                                </div>
                                <div style={{color: '#aaa', marginTop: '2px'}}>{spell.description}</div>
                            </button>
                        ))}
                        <button
                            style={{
                                fontSize: '10px',
                                padding: '3px 8px',
                                cursor: 'pointer',
                                background: 'transparent',
                                color: '#888',
                                border: '1px solid #444',
                                borderRadius: '3px',
                                marginTop: '4px'
                            }}
                            onClick={() => { this.dismissSpellChoice(); this.bumpVersion(); }}
                        >
                            Skip for now
                        </button>
                    </div>
                </div>
            );
        })()}

        {(() => {
            const rs: RollState = this.myInternalState['rollState'];
            const showFreeRoll: boolean = this.myInternalState['showFreeRoll'] ?? false;

            const refresh = () => {
                this.bumpVersion();
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
                    {c.isRoster && (() => {
                        const lvl = c.bondLevel ?? 0;
                        const prog = c.bondProgress ?? 0;
                        const cost = BOND_LEVEL_COSTS[lvl];
                        const pct = cost ? Math.min(100, (prog / cost) * 100) : 100;
                        return (
                            <div style={{marginTop: '4px', textAlign: 'left'}}>
                                <div style={{fontSize: '10px', color: '#888', marginBottom: '2px'}}>
                                    Bond {lvl}/10 {cost ? `(${prog}/${cost})` : '(max)'}
                                </div>
                                <div style={{
                                    height: '4px',
                                    width: '100%',
                                    background: '#222',
                                    borderRadius: '2px',
                                    overflow: 'hidden'
                                }}>
                                    <div style={{
                                        height: '100%',
                                        width: `${pct}%`,
                                        background: lvl >= 10 ? '#ffd56b' : '#7aaeff',
                                        transition: 'width 0.3s'
                                    }}/>
                                </div>
                            </div>
                        );
                    })()}
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
        `A trapdoor creaks beneath your boot. You notice the give just in time. [ROLL_REQUEST: ability=dex, dc=14, reason=avoiding a triggered floor trap] [STATE: ]`,
        `Niri tells you about her favorite childhood meal as you share rations by the fire. [BOND: niri+=1, reason=personal_moment] [STATE: companion.niri.mood=happy]`,
        `You take an arrow meant for Niri, shielding her without hesitation. [BOND: niri+=2, reason=defending] [STATE: hp-=4, companion.niri.mood=flustered]`,
        `Niri reaches into her satchel for a sigil-seed and channels healing light into your wound. [STATE: hp+=5, seeds-=1]`,
        `You set up camp in a hidden glade. The watchfires burn low; sleep finds you all. [LONG_REST]`,
        `An afternoon of shared stories deepens what's between you and Niri. (test: 5x bond) [BOND: niri+=5, reason=personal_moment]`,
        `Hours pass as you cross the windswept plains. [TIME: advance=2]`,
        `By the time you arrive, the lanterns are lit and the streets are emptying. [TIME: set=evening]`,
        `The tavern stays lively into the small hours. [TIME: set=late_night]`
    ];
    const counter = (this.myInternalState['testCounter'] || 0) % scenarios.length;
    const fakeReply = scenarios[counter];
    this.myInternalState['testCounter'] = counter + 1;

    const result = this.parseStateUpdate(fakeReply);
    console.log('Scenario:', counter, '|', fakeReply);
    console.log('Cleaned text:', result.cleanedText);
    console.log('New state:', this.myInternalState);

    this.bumpVersion();
}}
>
        Simulate combat
    </button>
</div>}
    </div>;
}

}
