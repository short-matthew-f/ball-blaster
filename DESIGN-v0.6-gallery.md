# Ball Blaster — v0.6 Proposal: Islands, Tokens, the Gear Gallery and the Loot Goblin

Oct 12, 2026 · **Proposal, owner-directed.** Decisions so far: obvious roadblocks; boss-locked currency; cash stays pooled; gear moves to a gallery where every item has its own tree (base → fork → base → terminal fork); forks exclusive but switchable; two choices per fork by default, three only where a third idea is real; a world's power-up is tied to the world you've beaten and world 1 has none; Overtime is replaced by the Loot Goblin (three pulls; the phase ends when the third shot ends). Replaces the v0.3 one-tree layout and the v0.4 loadout screen. Combat rules are unchanged except where a fork says otherwise.

## The idea in one line

**Stats live on world islands, gear lives in a gallery, every wall is a boss's face, and every boss kill ends with three pulls at a goblin full of loot.**

## Currencies

| Coin | Earned | Spends on |
|---|---|---|
| **Cash** (pooled, as now) | kills, waves, chests, the Loot Goblin; ×1.22 per stage | levels: island stat nodes, card base nodes |
| **Boss tokens** (one kind per boss: Stripe chip, Frost shard, Brass cog, Bog pearl, Ember, House chip) | first kill of that boss **3**, every repeat kill **1**, the Loot Goblin's **golden tooth** (third hit in the three pulls) **+1** | the portal to the next world, island capstones, gallery cards, forks, capstones |
| ~~Emeralds~~ | retired | migrate 1:1 into Stripe chips |

Tokens never cross worlds. A full boss run (kill + golden tooth) pays 2, so "I need five more chips" is three runs.

## The Loot Goblin (replaces Overtime)

The boss dies, the table clears, and a **golden goblin ball** waddles in with a sack. You get **three pulls**: three shots, and the phase ends when the third shot's balls stop. Every hit shakes loot out of it. It never dies and never attacks; it just runs.

- **Hits are ball contacts.** Hero, split children, spat balls and shards each count once per contact. A rail bounce back into it is a second hit. Arcs, poison ticks and blasts do not count.
- **Loot is random, the token isn't.** Each hit pays a seeded draw from three tiers, small / big / jackpot, weighted about 60 / 32 / 8, averaging about a sixth of a boss kill's cash per hit. The goblin's **golden tooth** drops on the third hit of the phase, whatever pull it lands on: the token is skill, luck only moves the cash.
- **Scurry.** When your balls stop, it rolls directly away from the hero at a fixed speed until it reaches a rail, then settles; if it is already on that rail it slides along it, away from you. It ignores obstacles and hazards (it's a goblin). It ends up on cushions and in corners, which is where bank shots live, and your leave after each hit decides the next geometry (Draw pulls you away from it, Follow chases it).
- **Unkillable.** Its "HP" is a coin sack that shrinks with each hit; the third hit reads as emptied. No stagger, no intent beyond running.
- **Tricks off, full power allowed, seeded per run** (the bot plays it; the gate stays deterministic). A miss is on you.
- **Feedback:** coins burst from it on every hit and fly to the HUD, a rising chime per hit, JACKPOT banner on the top tier, "3 PULLS" counter, and the stage pip remembers your best pull total.
- **Removed:** Overtime waves, the Overtime enrage clock, `atkBonus`, the loop rule about Overtime cash. Summary line "Waves cleared" becomes "Boss · Loot n".

## The island tree (stats)

One tree, drawn as a chain of islands in a spiral (island 2 north of 1, island 3 east of 2, …). Pan and zoom as now.

**Island 1 (Felt Hall)**: the 8-ball at the centre. Around it, cash nodes with levels: Damage I, Max HP I, Aim, Mass, Pocket Change (cash), Grit, Chain (combo), Bumpers (keystone). At the edges, two diamonds priced in Stripe chips: **ICE CAVERN** (portal, 3) and **FELT CAPSTONE** (global perk, 2, needs the island maxed).

**Islands 2–6**: the hub is the portal node you bought on the previous island, owned on arrival, and it *is* the world's counter (Ice Grip, Cleats, Mud Boots, Heat Shield, Lucky Socks). Around it the same kit at the next tier (Damage II = +12 %/level …) plus one or two nodes themed to the world (Ice: Reflex, Second Wind; Clockwork: Heavy Hits, Velocity; Bog: Wave Rest, Armor; Ember: Boss Heal, Sweep; Casino: Bank, Cascade). Prices in that world's cash band. Two diamonds at the edge: next portal, capstone.

**Loops**: loop rings hang off island 6's far edge, gated by House chips.

What you can reach in world 1: island 1 in full, the hub of island 2, nothing else. The wall is visible.

## The gallery (gear)

A grid of cards, four across, grouped Cues · Balls · Relics · Tricks, "n of 26 found" at the top, the five equip slots above it (Ball · Cue · Relic · Relic · Trick; Counter is shown but auto-equipped from the island). Card states: **locked** (silhouette, the boss icon and token cost), **open** (glow: you can afford it), **owned**, **equipped** (ring). Tap a card → its page: name, one-line effect, its tree drawn top-to-bottom, tap a node → BUY / SELECT, EQUIP at the bottom. The loadout screen goes away; the map's stage panel links here.

### A card's tree (same shape for every card)

```
        [ unlock ]           1 token
            |
        [ base I ]           cash
        [ base II ]          cash
            |
   { fork: A | B (| C) }     1 token each; one ACTIVE at a time; switch free in the gallery
            |
        [ base III ]         cash (requires any fork choice owned)
            |
   { capstone: X | Y }       2 tokens each; terminal; one ACTIVE; switch free
```

- **Base nodes** are "more": arcs, radius, duration, uses. They are what cash buys.
- **Forks are behaviour modifiers.** Owning several choices is allowed; exactly one is active per fork; switching the active choice is free and pre-run only. That is the only respec-like thing in the game.
- **Two choices by default, three only where the third is a real idea.**
- **Capstones** are the build-defining choice behind the second base node. Same rules, pricier.
- The bot must play every fork at least once; a fork that trivialises a gated stage gets its number cut, not its idea.

### Cards by world (which boss's token opens them)

A world's power-up belongs to the world you beat to get it. **World 1 has no power-up**: its cards change how the ball feels, not what it does. The first elemental effect arrives with Ice.

| World · token | Cards | The world's power-up |
|---|---|---|
| 1 Felt Hall · Stripe chip | Break cue, Heavy ball, Ricochet, Momentum, Recall, Lantern | none |
| 2 Ice Cavern · Frost shard | Jump cue, Light ball, **Chill**, Mirror, Split, Shockwave | Chill |
| 3 Clockwork · Brass cog | Draw cue, Sticky ball, **Lightning**, Static, Spitter, Time Stop | Lightning |
| 4 Bog · Bog pearl | Follow cue, **Poison**, Thorns, Shrapnel, Rack 'Em | Poison |
| 5 Ember Pit · Ember | Comet ball, **Fire** (new), Explosive, Magnet | Fire |
| 6 Neon Casino · House chip | Greed, Decoy, Bulwark | Greed |

Lightning and Poison move later than today. Anyone who owns them keeps them (migration below). Worlds 4–6 cards' forks ship with v0.6; the worlds themselves later.

### Fork catalogue (first draft: pick, cut, rename)

Format: base → **fork** → base → **capstone**. Numbers are starting points for the bot.

**World 1 (feel, no element)**

- **Break cue**: +5 % speed → **Slam** (+15 % more, no preview) · **Crack** (normal speed, first hit +1 stagger) → min power 40 % → **Breaker** (first hit shoves 2×) · **Steady** (preview back on).
- **Heavy ball**: +1 mass → **Anvil** (stops dead on first hit, 2× damage) · **Wrecking** (shoves 2×, no damage bonus) → … → **Juggernaut** (immune to the first charge each phase) · **Avalanche** (every enemy it moves takes 1).
- **Ricochet**: max +1 → **Bank** (+2 per rail) · **Carom** (enemy-to-enemy bounces count as rails) → max +1 → **Pocket** (a 3-rail first hit pays cash ×2) · **Ghost Rail** (rails return 20 % speed).
- **Momentum**: max +1 → **Streak** (threshold 1 hit) · **Snowball** (also +5 % cash per step) → … → **Unstoppable** (a streak of 3 makes the next shot ignore shields) · **Overdrive** (at max, +20 % speed).
- **Recall**: +1 use → **Blink** (recall to the nearest safe spot, not the start) · **Rewind** (recall to where the shot was taken from) → +1 use → **Encore** (a recall used during the enemy phase skips the next charge) · **Anchor** (after a recall your next shot is +2).
- **Lantern** (counters dark): reach glyph +1 → **Beacon** (intents visible; enemies in your reach glow) · **Glare** (shooters within reach lose their shot) → … → **Sunrise** (dark is off for the first two waves) · **Moth** (shooters aim at the lantern spot, not you).

**World 2 (Chill)**

- **Chill**: +1 phase → **Deep Freeze** (two chills = frozen) · **Brittle** (chilled take +1) · **Frostbite** (chill spreads on contact) → … → **Glacier** (chilled enemies block charges: cover) · **Icebreaker** (killing a chilled enemy chills its neighbours).
- **Jump cue**: −1 damage penalty → **Long Jump** (passes two) · **Stomp** (landing staggers the passed enemy) → … → **Skip** (passes rails too: one wrap) · **Pounce** (landing hit is doubled).
- **Light ball**: +speed → **Zip** (+15 % speed, no shove) · **Feather** (ignores belts, mud and ice) → … → **Phase** (passes through staggered enemies) · **Flurry** (two shots per turn at half damage).
- **Split**: +1 child → **Twins** (2 children at full damage, short life) · **Swarm** (4 at 1 damage) · **Mitosis** (children split once more) → child life → **Rally** (children that return to the hero add +1 to the next shot) · **Shatter** (children shatter frozen/staggered for double).
- **Mirror**: +10 % → **Full Mirror** (50 %) · **Lens** (reflected shots deal your damage) → … → **Hall of Mirrors** (every reflection also staggers) · **Polish** (shooters that miss you take 1).
- **Shockwave**: +1 use → **Quake** (radius 90) · **Pulse** (shoves 30 px, no stagger) → … → **Aftershock** (a second wave next phase) · **Epicentre** (enemies touching you take 2).

**World 3 (Lightning)**

- **Lightning**: +1 arc, +20 range → **Chain** (arcs jump twice more at 1 dmg) · **Thunder** (one arc at full damage, +1 stagger) · **Static Field** (an arc on every rail bounce) → +1 arc damage → **Storm** (every kill emits an arc) · **Conductor** (bumpers and obstacles arc too).
- **Static**: +1 → **Overload** (2, chains to one neighbour) · **Paralysis** (staggered enemies stay staggered next phase) → … → **Grounded** (staggered enemies can't be healed) · **Tesla** (3 staggers in a shot: a free arc).
- **Draw cue**: −power penalty → **Snap Back** (returns faster, hits on the way) · **Screw** (returns at an angle: side-spin) → … → **Masse** (the return path is previewed) · **Pull** (the enemy is dragged 20 px with you).
- **Sticky ball**: +1 stagger → **Glue** (the enemy is held: skips next intent) · **Web** (neighbours within 30 px also +1 stagger) → … → **Trap** (a held enemy takes double from the next hit) · **Cling** (you take no charge damage from the held enemy).
- **Spitter**: interval → **Gatling** (fast, 1 dmg) · **Mortar** (slow, each spat ball is a small blast) → life → **Sentry** (keeps spitting at chargers during the enemy phase) · **Bandolier** (spat balls stay as mines until the phase starts).
- **Time Stop**: +1 use → **Freeze** (nobody even Advances) · **Slow** (two phases at half) → … → **Clockwork** (belts and hazards also stop) · **Haste** (you get a second shot in the stopped phase).

**World 4 (Poison)**

- **Poison**: +1 stack per contact, cap +1 → **Plague** (poison spreads when a poisoned enemy touches another) · **Rot** (stacks never decay) → tick +1 → **Blight** (a poisoned enemy that dies leaves a cloud that stacks anyone inside at the next phase) · **Leech** (poison ticks heal you 1 per 3 damage, through the heal curve).
- **Thorns**: +1 → **Spikes** (3) · **Barbs** (the charger is poisoned 2) → … → **Bulwark-lite** (first charge each phase halved) · **Riposte** (a charger that hits you is shoved back 40 px).
- **Follow cue**: keep 70 % → **Plow** (80 %, +1 to the second hit) · **Roll** (no charge penalty) → … → **Cannon** (third contact too) · **Topspin** (rails after the first hit return full speed).
- **Shrapnel**: +1 shard → **Flak** (5 shards, 1 dmg) · **Spear** (one shard at your damage) → life → **Fragmentation** (shard kills release shards) · **Plating** (unused shards orbit you as a 1-hit shield).
- **Rack 'Em**: +1 use → **Tight** (30 px) · **Scatter** (away from the centre: breaks cover) → … → **Re-rack** (also resets intents) · **Table Roll** (enemies pulled across a hazard take it).

**World 5 (Fire)**

- **Fire** (new): burn 2 phases, 1/phase → **Wildfire** (spreads when a burning enemy touches another) · **Puddle** (impact leaves a pool; anyone through it burns) → burn +1 → **Inferno** (burn damage doubles each phase, max 4) · **Firewalk** (lava heals you; bomber blasts don't burn you).
- **Explosive**: radius → **Cluster** (three small blasts along the path) · **Delayed** (sticks, explodes at phase start) → keep speed → **Chain Reaction** (blast kills explode) · **Shockproof** (blasts stagger +2).
- **Comet ball**: trail length → **Tail** (trail burns) · **Meteor** (impact blast) → … → **Impact** (first hit ×2 if above 80 % power) · **Halo** (trail is cover).
- Magnet: base only until Ember ships.

**World 6**: Greed, Decoy, Bulwark: base only until Casino ships.

## Migration (v3 → v4 save)

- Emeralds → Stripe chips 1:1. Cash and stats kept.
- Island stat ids (`damage`, `maxHp`, `aim`, `mass`, `cashBonus`, grafts' `g{w}_*`) keep their ids and levels. Core nodes that move islands keep their ids. Any node that no longer exists refunds its spend (small, nothing like the v2 refund).
- Owned gear stays owned wherever its card lands (a save with Lightning keeps Lightning); `${id}_lv` becomes the card's base I. Nobody owns a fork at migration.
- `unlocked` becomes "portals owned": a save with `unlocked ≥ 4` owns ICE CAVERN; ≥ 8 owns CLOCKWORK WORKS.

## Build order

1. Tokens: drop, HUD, summary line, save field. Emerald retirement. The Loot Goblin (goblin kind with a flee intent, loot table, golden tooth, HUD pulls counter, summary) and Overtime removal; gate re-run.
2. Island tree: node tables per island, spiral layout, portals/capstones, tree screen (mostly the v0.3 screen with new data).
3. Gallery: card model (base/fork/capstone, active choice), gallery screen replacing loadout, card page, `RunStats` gains per-card fork/capstone ids.
4. Forks in the sim: world 1–3 cards first (18 cards), bot fork policy, gate; then worlds 4–6 cards.
5. Fable review; migrate; ship.

## Decision log

| Decision | Reason |
|---|---|
| Boss tokens, one kind per boss, never cross worlds | the wall is a face; farming a boss is always the answer |
| Cash stays pooled | per-world cash punishes grinding and needs an exchange rate (Darkest Dungeon's heirloom trading) |
| Gear in a gallery with per-card trees; stats on islands | gear is a collection, stats are geography |
| Forks exclusive but switchable, free, pre-run | behaviour modifiers are the point; the switch is the only respec |
| Two fork choices by default | a third only when it is a real idea |
| A world's power-up belongs to the world you beat; world 1 has none | Chill at Ice, Lightning at Clockwork, Poison at Bog, Fire at Ember |
| The Loot Goblin replaces Overtime | Overtime could only end in a death ("I don't really feel any achievement with overtime"); three pulls at a fleeing goblin end in loot you earned, multi-hits reward builds and bank shots, and the golden tooth (third hit) is the token: skill, not luck |
