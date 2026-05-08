import { world, system, DynamicPropertiesDefinition } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";

const playerSelections = new Map(); // PlayerId -> { p1, p2, genPoint, baseSnapshotName }
const animations = new Map(); // Name -> { frames: [], delay: 5, loop: false }
const activeAnimations = new Map(); // Animation key -> interval id
const pendingGenPointSelection = new Set();
const STORAGE_KEY = "keyframelite:animations";
let showBranding = true;

function getSelection(player) {
    return playerSelections.get(player.id) || { p1: null, p2: null, genPoint: null, baseSnapshotName: null };
}

function setSelection(player, selection) {
    playerSelections.set(player.id, selection);
    return selection;
}

function getBounds(selection) {
    return {
        min: {
            x: Math.min(selection.p1.x, selection.p2.x),
            y: Math.min(selection.p1.y, selection.p2.y),
            z: Math.min(selection.p1.z, selection.p2.z),
        },
        max: {
            x: Math.max(selection.p1.x, selection.p2.x),
            y: Math.max(selection.p1.y, selection.p2.y),
            z: Math.max(selection.p1.z, selection.p2.z),
        },
    };
}

function requireSelectionArea(player) {
    const selection = getSelection(player);
    if (!selection.p1 || !selection.p2) {
        player.sendMessage("§cSelect two points first: right-click for P1, sneak + right-click for P2.");
        return null;
    }
    return selection;
}

function safeAnimKey(player, animName) {
    return `${player.id}:${animName}`;
}

function serializeAnimations() {
    const data = {};
    for (const [name, anim] of animations.entries()) {
        data[name] = {
            frames: anim.frames,
            delay: anim.delay ?? 5,
            loop: Boolean(anim.loop),
        };
    }
    return JSON.stringify(data);
}

function saveAnimationsToStorage() {
    world.setDynamicProperty(STORAGE_KEY, serializeAnimations());
}

function parseAnimationLibrary(payload) {
    const parsed = JSON.parse(payload);
    const nextAnimations = new Map();

    for (const [name, anim] of Object.entries(parsed)) {
        if (!anim || !Array.isArray(anim.frames)) continue;
        nextAnimations.set(name, {
            frames: anim.frames.filter((frame) => typeof frame === "string"),
            delay: Number.isFinite(anim.delay) ? anim.delay : 5,
            loop: Boolean(anim.loop),
        });
    }

    return nextAnimations;
}

function loadAnimationsFromStorage() {
    const raw = world.getDynamicProperty(STORAGE_KEY);
    if (typeof raw !== "string" || !raw.length) return;

    try {
        const nextAnimations = parseAnimationLibrary(raw);
        animations.clear();
        for (const [name, anim] of nextAnimations.entries()) animations.set(name, anim);
    } catch {
        // Ignore corrupted storage and keep the in-memory state empty.
    }
}

function importAnimationLibrary(raw) {
    const nextAnimations = parseAnimationLibrary(raw);
    animations.clear();
    for (const [name, anim] of nextAnimations.entries()) animations.set(name, anim);
    saveAnimationsToStorage();
    return nextAnimations.size;
}

function exportAnimationLibrary() {
    return serializeAnimations();
}

function sendLongMessage(player, text) {
    const chunkSize = 200;
    for (let i = 0; i < text.length; i += chunkSize) {
        player.sendMessage(text.slice(i, i + chunkSize));
    }
}

function renameAnimation(oldName, newName) {
    if (!animations.has(oldName) || animations.has(newName)) return false;
    const anim = animations.get(oldName);
    animations.delete(oldName);
    animations.set(newName, anim);
    saveAnimationsToStorage();
    return true;
}

function deleteAnimation(name) {
    const removed = animations.delete(name);
    if (removed) saveAnimationsToStorage();
    return removed;
}

world.afterEvents.worldInitialize.subscribe((event) => {
    const definition = new DynamicPropertiesDefinition();
    definition.defineString(STORAGE_KEY, 32767);
    event.propertyRegistry.registerWorldDynamicProperties(definition);
    loadAnimationsFromStorage();
});

/**
 * Takes a snapshot of the current selection to allow for restoration later.
 */
async function takeBaseSnapshot(player, selection) {
    const snapshotName = `base_snap_${player.id}`;
    const { min, max } = getBounds(selection);

    try {
        await player.dimension.runCommandAsync(`structure save "${snapshotName}" ${min.x} ${min.y} ${min.z} ${max.x} ${max.y} ${max.z} true memory`);
        selection.baseSnapshotName = snapshotName;
        setSelection(player, selection);
        player.sendMessage("§7[System] Base snapshot saved.");
    } catch (e) {
        player.sendMessage(`§cFailed to take snapshot: ${e}`);
    }
}

/**
 * Restores the selection area from the base snapshot.
 */
async function restoreBaseSnapshot(player) {
    const selection = requireSelectionArea(player);
    if (!selection || !selection.baseSnapshotName) {
        player.sendMessage("§cNo base snapshot available yet.");
        return;
    }

    const { min } = getBounds(selection);

    try {
        await player.dimension.runCommandAsync(`structure load "${selection.baseSnapshotName}" ${min.x} ${min.y} ${min.z}`);
        player.sendMessage("§7[System] Selection area restored.");
    } catch (e) {
        player.sendMessage(`§cFailed to restore: ${e}`);
    }
}

function stopAnimationByKey(animKey) {
    const interval = activeAnimations.get(animKey);
    if (interval !== undefined) {
        system.clearRun(interval);
        activeAnimations.delete(animKey);
    }
}

function stopPlayerAnimations(player) {
    for (const key of Array.from(activeAnimations.keys())) {
        if (key.startsWith(`${player.id}:`)) {
            stopAnimationByKey(key);
        }
    }
}

// --- Wand Interactions ---

world.beforeEvents.itemUseOn.subscribe((event) => {
    const { itemStack, source: player, block } = event;

    if (itemStack?.typeId !== "keyframelite:wand") return;

    event.cancel = true;

    system.run(() => {
        const selection = getSelection(player);

        if (!player.isSneaking) {
            selection.p1 = block.location;
            player.sendMessage(`§aPoint 1 set to ${block.location.x}, ${block.location.y}, ${block.location.z}`);
        } else {
            selection.p2 = block.location;
            player.sendMessage(`§bPoint 2 set to ${block.location.x}, ${block.location.y}, ${block.location.z}`);
        }

        setSelection(player, selection);

        if (selection.p1 && selection.p2 && !selection.baseSnapshotName) {
            takeBaseSnapshot(player, selection);
        }
    });
});

world.afterEvents.entityHitBlock.subscribe((event) => {
    const { damager, block } = event;
    if (damager.typeId !== "minecraft:player" || !pendingGenPointSelection.has(damager.id)) return;

    const selection = getSelection(damager);
    selection.genPoint = block.location;
    setSelection(damager, selection);
    pendingGenPointSelection.delete(damager.id);
    damager.sendMessage(`§6Generation point set to ${block.location.x}, ${block.location.y}, ${block.location.z}!`);
});

world.beforeEvents.itemUse.subscribe((event) => {
    const { itemStack, source: player } = event;

    if (itemStack?.typeId !== "keyframelite:wand") return;

    event.cancel = true;
    system.run(() => showMainMenu(player));
});

// --- Commands ---

world.beforeEvents.chatSend.subscribe((event) => {
    const { message, sender: player } = event;

    if (!message.startsWith("!anim")) return;

    event.cancel = true;
    const args = message.trim().split(/\s+/);
    const subCommand = args[1];

    system.run(() => {
        if (!subCommand) {
            player.sendMessage("§eCommands:\n§f!anim wand §7- Get tool\n§f!anim branding §7- Toggle overlay\n§f!anim export §7- Print library JSON\n§f!anim import <json> §7- Restore library");
            return;
        }

        const payload = message.slice(message.indexOf(subCommand) + subCommand.length).trim();

        if (subCommand === "wand") {
            player.runCommandAsync("give @s keyframelite:wand");
            player.sendMessage("§eYou have been given the Animation Wand.");
        } else if (subCommand === "branding") {
            showBranding = !showBranding;
            player.sendMessage(`§eBranding overlay is now ${showBranding ? "§aenabled" : "§cdisabled"}§e.`);
        } else if (subCommand === "export") {
            const exported = exportAnimationLibrary();
            player.sendMessage("§eAnimation library export:");
            sendLongMessage(player, exported);
        } else if (subCommand === "import") {
            if (!payload) {
                player.sendMessage("§cUse: !anim import <json>");
                return;
            }

            try {
                const count = importAnimationLibrary(payload);
                player.sendMessage(`§aImported ${count} animation(s).`);
            } catch (e) {
                player.sendMessage(`§cImport failed: ${e}`);
            }
        } else {
            player.sendMessage("§eCommands:\n§f!anim wand §7- Get tool\n§f!anim branding §7- Toggle overlay\n§f!anim export §7- Print library JSON\n§f!anim import <json> §7- Restore library");
        }
    });
});

// --- UI / Logic ---

async function showMainMenu(player) {
    const form = new ActionFormData()
        .title("KeyframeLite")
        .body("Animation tools and library actions")
        .button("Save Keyframe")
        .button("Play Animation")
        .button("Manage Animations")
        .button("Set Generation Point")
        .button("Finish & Restore Area")
        .button("Export to Function")
        .button("Stop Animations")
        .button("Generate Command Blocks")
        .button("Help");

    const response = await form.show(player);
    if (response.canceled) return;

    switch (response.selection) {
        case 0: return showSaveKeyframeForm(player);
        case 1: return showPlayAnimationForm(player);
        case 2: return showManageAnimationsForm(player);
        case 3:
            pendingGenPointSelection.add(player.id);
            player.sendMessage("§6Punch a block with the wand to set the generation point.");
            return;
        case 4: return restoreBaseSnapshot(player);
        case 5: return showExportFunctionForm(player);
        case 6: return stopAllAnimations(player);
        case 7: return showGenerateCommandBlocksForm(player);
        case 8: return showHelp(player);
    }
}

async function showSaveKeyframeForm(player) {
    const selection = requireSelectionArea(player);
    if (!selection) return;

    const form = new ModalFormData()
        .title("Save Keyframe")
        .textField("Animation Name", "my_animation")
        .textField("Frame Index", "0");

    const response = await form.show(player);
    if (response.canceled) return;

    const [animNameRaw, frameIdxRaw] = response.formValues;
    const animName = String(animNameRaw || "").trim();
    const frameIdx = String(frameIdxRaw || "").trim();
    if (!animName || !frameIdx) {
        player.sendMessage("§cAnimation name and frame index are required.");
        return;
    }

    const structureName = `anim_${animName}_f${frameIdx}`;
    const { min, max } = getBounds(selection);

    try {
        await player.dimension.runCommandAsync(`structure save "${structureName}" ${min.x} ${min.y} ${min.z} ${max.x} ${max.y} ${max.z} true memory`);
        const anim = animations.get(animName) || { frames: [], delay: 5, loop: false };
        if (!anim.frames.includes(structureName)) {
            anim.frames.push(structureName);
            anim.frames.sort((a, b) => parseInt(a.split("_f").pop(), 10) - parseInt(b.split("_f").pop(), 10));
        }
        animations.set(animName, anim);
        saveAnimationsToStorage();
        player.sendMessage(`§aKeyframe saved: ${structureName}`);
    } catch (e) {
        player.sendMessage(`§cError: ${e}`);
    }
}

async function showPlayAnimationForm(player) {
    const animNames = Array.from(animations.keys());
    if (animNames.length === 0) {
        player.sendMessage("§cNo animations saved yet.");
        return;
    }

    const form = new ModalFormData()
        .title("Play Animation")
        .dropdown("Select Animation", animNames)
        .slider("Delay (ticks)", 1, 20, 1, 5)
        .toggle("Loop?", false);

    const response = await form.show(player);
    if (response.canceled) return;

    const [animIdx, delay, loop] = response.formValues;
    const animName = animNames[animIdx];
    const anim = animations.get(animName);
    if (!anim || anim.frames.length === 0) {
        player.sendMessage("§cThat animation has no frames.");
        return;
    }

    playAnimation(player, animName, anim, delay, loop);
}

function playAnimation(player, animName, anim, delay, loop) {
    const animKey = safeAnimKey(player, animName);
    stopAnimationByKey(animKey);

    let frame = 0;
    const interval = system.runInterval(() => {
        const selection = getSelection(player);
        if (!selection.p1 || !selection.p2) {
            stopAnimationByKey(animKey);
            player.sendMessage("§cAnimation stopped because the selection is missing.");
            return;
        }

        if (frame >= anim.frames.length) {
            if (loop) {
                frame = 0;
            } else {
                stopAnimationByKey(animKey);
                return;
            }
        }

        const { min } = getBounds(selection);
        player.dimension.runCommandAsync(`structure load "${anim.frames[frame]}" ${min.x} ${min.y} ${min.z}`);
        frame++;
    }, delay);

    activeAnimations.set(animKey, interval);
}

async function showGenerateCommandBlocksForm(player) {
    const animNames = Array.from(animations.keys());
    if (animNames.length === 0) {
        player.sendMessage("§cNo animations saved yet.");
        return;
    }

    const selection = requireSelectionArea(player);
    if (!selection || !selection.genPoint) {
        player.sendMessage("§cSet a generation point first.");
        return;
    }

    const form = new ModalFormData()
        .title("Generate Command Blocks")
        .dropdown("Select Animation", animNames)
        .slider("Delay (ticks)", 1, 20, 1, 5);

    const response = await form.show(player);
    if (response.canceled) return;

    const [animIdx] = response.formValues;
    const animName = animNames[animIdx];
    const anim = animations.get(animName);
    const { min } = getBounds(selection);
    const genPos = selection.genPoint;

    player.sendMessage(`§eGenerating command blocks for ${animName}...`);
    for (let i = 0; i < anim.frames.length; i++) {
        const cmd = `structure load "${anim.frames[i]}" ${min.x} ${min.y} ${min.z}`;
        const x = genPos.x + i;
        const blockType = i === 0 ? "impulse_command_block" : "chain_command_block";
        player.dimension.runCommandAsync(`setblock ${x} ${genPos.y} ${genPos.z} ${blockType} ["facing_direction":5]`);
        player.sendMessage(`§7[Frame ${i}] at ${x}, ${genPos.y}, ${genPos.z}: §f${cmd}`);
    }
    player.sendMessage("§6Note: enter the displayed commands into the blocks manually.");
}

function stopAllAnimations(player) {
    stopPlayerAnimations(player);
    player.sendMessage("§aStopped all animations for this player.");
}

async function showExportFunctionForm(player) {
    const animNames = Array.from(animations.keys());
    if (animNames.length === 0) {
        player.sendMessage("§cNo animations saved yet.");
        return;
    }

    const form = new ModalFormData()
        .title("Export")
        .dropdown("Select Animation", animNames)
        .slider("Delay", 1, 20, 1, 5);

    const response = await form.show(player);
    if (response.canceled) return;

    const anim = animations.get(animNames[response.formValues[0]]);
    if (!anim) return;

    player.sendMessage(`§e--- Export ${animNames[response.formValues[0]]} ---`);
    for (let i = 0; i < anim.frames.length; i++) {
        player.sendMessage(`§f/structure load "${anim.frames[i]}" ...`);
    }
}

async function showManageAnimationsForm(player) {
    const animNames = Array.from(animations.keys());
    if (animNames.length === 0) {
        player.sendMessage("§cNo animations saved yet.");
        return;
    }

    const actionForm = new ActionFormData()
        .title("Animation Library")
        .body("Choose a library action.")
        .button("Rename")
        .button("Delete")
        .button("Back");

    const actionResponse = await actionForm.show(player);
    if (actionResponse.canceled || actionResponse.selection === 2) return;

    const pickForm = new ModalFormData()
        .title("Select Animation")
        .dropdown("Animation", animNames);

    const pickResponse = await pickForm.show(player);
    if (pickResponse.canceled) return;

    const selected = animNames[pickResponse.formValues[0]];
    if (!selected) return;

    if (actionResponse.selection === 0) {
        const renameForm = new ModalFormData()
            .title("Rename Animation")
            .textField("New name", selected);
        const renameResponse = await renameForm.show(player);
        if (renameResponse.canceled) return;

        const newName = String(renameResponse.formValues[0] || "").trim();
        if (!newName || newName === selected) {
            player.sendMessage("§cEnter a different name.");
            return;
        }

        if (!renameAnimation(selected, newName)) {
            player.sendMessage("§cThat name is already in use.");
            return;
        }

        player.sendMessage(`§aRenamed ${selected} to ${newName}.`);
        return;
    }

    if (deleteAnimation(selected)) {
        player.sendMessage(`§cDeleted animation ${selected}.`);
    }
}

function showHelp(player) {
    player.sendMessage("§eRight-click for P1, sneak + right-click for P2, punch for generation point, use the wand in air for the menu.");
}

// --- Branding Overlay ---
system.runInterval(() => {
    if (!showBranding) return;

    for (const player of world.getAllPlayers()) {
        player.onScreenDisplay.setActionBar("§l§bKEYFRAME LITE ++ §r§7BY §eBAHOST01 §8(#agente0981 In Discord)");
    }
}, 40);
