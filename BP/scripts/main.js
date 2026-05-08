import { world, system } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";

const playerSelections = new Map(); // PlayerId -> { p1, p2, genPoint, baseSnapshotName }
const animations = new Map(); // Name -> { frames: [], delay: 5, loop: false }
const activeAnimations = new Set(); // To track and stop looped animations
const pendingGenPointSelection = new Set();

/**
 * Takes a snapshot of the current selection to allow for restoration later.
 */
async function takeBaseSnapshot(player, selection) {
    const snapshotName = `base_snap_${player.id}`;
    const min = { x: Math.min(selection.p1.x, selection.p2.x), y: Math.min(selection.p1.y, selection.p2.y), z: Math.min(selection.p1.z, selection.p2.z) };
    const max = { x: Math.max(selection.p1.x, selection.p2.x), y: Math.max(selection.p1.y, selection.p2.y), z: Math.max(selection.p1.z, selection.p2.z) };
    
    try {
        await player.dimension.runCommandAsync(`structure save "${snapshotName}" ${min.x} ${min.y} ${min.z} ${max.x} ${max.y} ${max.z} true memory`);
        selection.baseSnapshotName = snapshotName;
        player.sendMessage("§7[System] Base snapshot taken. Area will be restored after saving/stopping.");
    } catch (e) {
        player.sendMessage(`§cFailed to take snapshot: ${e}`);
    }
}

/**
 * Restores the selection area from the base snapshot.
 */
async function restoreBaseSnapshot(player) {
    const selection = playerSelections.get(player.id);
    if (!selection || !selection.baseSnapshotName) return;

    const min = { x: Math.min(selection.p1.x, selection.p2.x), y: Math.min(selection.p1.y, selection.p2.y), z: Math.min(selection.p1.z, selection.p2.z) };
    
    try {
        await player.dimension.runCommandAsync(`structure load "${selection.baseSnapshotName}" ${min.x} ${min.y} ${min.z}`);
        player.sendMessage("§7[System] Selection area restored to original state.");
    } catch (e) {
        player.sendMessage(`§cFailed to restore: ${e}`);
    }
}

// --- Wand Interactions ---

world.beforeEvents.itemUseOn.subscribe((event) => {
    const { itemStack, source: player, block } = event;
    
    if (itemStack?.typeId === "keyframelite:wand") {
        event.cancel = true; // Prevent default block interaction
        
        system.run(() => {
            let selection = playerSelections.get(player.id) || { p1: null, p2: null, genPoint: null };
            
            if (!player.isSneaking) {
                selection.p1 = block.location;
                player.sendMessage(`§aPoint 1 (Animation Area) set to ${block.location.x}, ${block.location.y}, ${block.location.z}`);
            } else {
                selection.p2 = block.location;
                player.sendMessage(`§bPoint 2 (Animation Area) set to ${block.location.x}, ${block.location.y}, ${block.location.z}`);
            }
            
            playerSelections.set(player.id, selection);

            // Automatically take base snapshot once both points are set for the first time
            if (selection.p1 && selection.p2 && !selection.baseSnapshotName) {
                takeBaseSnapshot(player, selection);
            }
        });
    }
});

// Use Hit Block for Gen Point selection
world.afterEvents.entityHitBlock.subscribe((event) => {
    const { damager, block } = event;
    if (damager.typeId === "minecraft:player" && pendingGenPointSelection.has(damager.id)) {
        let selection = playerSelections.get(damager.id) || { p1: null, p2: null, genPoint: null };
        selection.genPoint = block.location;
        playerSelections.set(damager.id, selection);
        pendingGenPointSelection.delete(damager.id);
        damager.sendMessage(`§6Generation Point set to ${block.location.x}, ${block.location.y}, ${block.location.z}!`);
    }
});

world.beforeEvents.itemUse.subscribe((event) => {
    const { itemStack, source: player } = event;
    
    if (itemStack?.typeId === "keyframelite:wand") {
        event.cancel = true;
        system.run(() => {
            showMainMenu(player);
        });
    }
});

// --- Commands ---

world.beforeEvents.chatSend.subscribe((event) => {
    const { message, sender: player } = event;
    
    if (message.startsWith("!anim")) {
        event.cancel = true;
        const args = message.split(" ");
        const subCommand = args[1];
        
        system.run(() => {
            if (subCommand === "wand") {
                player.runCommandAsync("give @s keyframelite:wand");
                player.sendMessage("§eYou have been given the Animation Wand!");
            } else {
                player.sendMessage("§eUse '!anim wand' to get the tool, or Right-Click with it to open the menu.");
            }
        });
    }
});

// --- UI / Logic ---

async function showMainMenu(player) {
    const form = new ActionFormData()
        .title("KeyframeLite")
        .body("What would you like to do?")
        .button("Save Keyframe")
        .button("Finish & Restore Area")
        .button("Play Animation")
        .button("Generate Command Blocks")
        .button("Set Generation Point")
        .button("Stop Animations")
        .button("Export to Function")
        .button("Help");

    const response = await form.show(player);
    if (response.canceled) return;

    switch (response.selection) {
        case 0: showSaveKeyframeForm(player); break;
        case 1: restoreBaseSnapshot(player); break;
        case 2: showPlayAnimationForm(player); break;
        case 3: showGenerateCommandBlocksForm(player); break;
        case 4: 
            pendingGenPointSelection.add(player.id);
            player.sendMessage("§6Punch a block with the wand to set the Generation Point!");
            break;
        case 5: stopAllAnimations(player); break;
        case 6: showExportFunctionForm(player); break;
        case 7: showHelp(player); break;
    }
}

async function showSaveKeyframeForm(player) {
    const selection = playerSelections.get(player.id);
    if (!selection || !selection.p1 || !selection.p2) {
        player.sendMessage("§cPlease select two points first! (Right-Click block for P1, Sneak + Right-Click for P2)");
        return;
    }

    const form = new ModalFormData()
        .title("Save Keyframe")
        .textField("Animation Name", "my_animation")
        .textField("Frame Index", "0");

    const response = await form.show(player);
    if (response.canceled) return;

    const [animName, frameIdx] = response.formValues;
    const structureName = `anim_${animName.trim()}_f${frameIdx.trim()}`;

    const min = { x: Math.min(selection.p1.x, selection.p2.x), y: Math.min(selection.p1.y, selection.p2.y), z: Math.min(selection.p1.z, selection.p2.z) };
    const max = { x: Math.max(selection.p1.x, selection.p2.x), y: Math.max(selection.p1.y, selection.p2.y), z: Math.max(selection.p1.z, selection.p2.z) };

    try {
        await player.dimension.runCommandAsync(`structure save "${structureName}" ${min.x} ${min.y} ${min.z} ${max.x} ${max.y} ${max.z} true memory`);
        let anim = animations.get(animName) || { frames: [], delay: 5, loop: false };
        if (!anim.frames.includes(structureName)) {
            anim.frames.push(structureName);
            anim.frames.sort((a, b) => parseInt(a.split('_f').pop()) - parseInt(b.split('_f').pop()));
        }
        animations.set(animName, anim);
        player.sendMessage(`§aKeyframe saved: ${structureName}`);
    } catch (e) {
        player.sendMessage(`§cError: ${e}`);
    }
}

async function showPlayAnimationForm(player) {
    const animNames = Array.from(animations.keys());
    if (animNames.length === 0) return player.sendMessage("§cNo animations!");

    const form = new ModalFormData()
        .title("Play Animation")
        .dropdown("Select Animation", animNames)
        .slider("Delay (ticks)", 1, 20, 1, 5)
        .toggle("Loop?", false);

    const response = await form.show(player);
    if (response.canceled) return;

    const [animIdx, delay, loop] = response.formValues;
    const animName = animNames[animIdx];
    playAnimation(player, animName, animations.get(animName), delay, loop);
}

function playAnimation(player, animName, anim, delay, loop) {
    if (activeAnimations.has(animName)) return;
    activeAnimations.add(animName);
    let frame = 0;
    const interval = system.runInterval(() => {
        if (!activeAnimations.has(animName)) { system.clearRun(interval); return; }
        if (frame >= anim.frames.length) {
            if (loop) frame = 0; else { system.clearRun(interval); activeAnimations.delete(animName); return; }
        }
        const selection = playerSelections.get(player.id);
        const min = { x: Math.min(selection.p1.x, selection.p2.x), y: Math.min(selection.p1.y, selection.p2.y), z: Math.min(selection.p1.z, selection.p2.z) };
        player.dimension.runCommandAsync(`structure load "${anim.frames[frame]}" ${min.x} ${min.y} ${min.z}`);
        frame++;
    }, delay);
}

async function showGenerateCommandBlocksForm(player) {
    const animNames = Array.from(animations.keys());
    if (animNames.length === 0) return player.sendMessage("§cNo animations!");

    const selection = playerSelections.get(player.id);
    if (!selection || !selection.genPoint) return player.sendMessage("§cSet a Generation Point first!");

    const form = new ModalFormData()
        .title("Generate Command Blocks")
        .dropdown("Select Animation", animNames)
        .slider("Delay (ticks)", 1, 20, 1, 5);

    const response = await form.show(player);
    if (response.canceled) return;

    const [animIdx, delay] = response.formValues;
    const animName = animNames[animIdx];
    const anim = animations.get(animName);
    
    const genPos = selection.genPoint;
    const targetPos = { x: Math.min(selection.p1.x, selection.p2.x), y: Math.min(selection.p1.y, selection.p2.y), z: Math.min(selection.p1.z, selection.p2.z) };

    player.sendMessage(`§eGenerating for ${animName}...`);
    for (let i = 0; i < anim.frames.length; i++) {
        const cmd = `structure load "${anim.frames[i]}" ${targetPos.x} ${targetPos.y} ${targetPos.z}`;
        const x = genPos.x + i;
        const blockType = (i === 0) ? "impulse_command_block" : "chain_command_block";
        player.dimension.runCommandAsync(`setblock ${x} ${genPos.y} ${genPos.z} ${blockType} ["facing_direction":5]`);
        player.sendMessage(`§7[Frame ${i}] at ${x}, ${genPos.y}, ${genPos.z}: §f${cmd}`);
    }
    player.sendMessage("§6Note: You must manually enter the commands into the blocks.");
}

function stopAllAnimations(player) { activeAnimations.clear(); player.sendMessage("§aStopped!"); }

async function showExportFunctionForm(player) {
    const animNames = Array.from(animations.keys());
    if (animNames.length === 0) return;
    const form = new ModalFormData().title("Export").dropdown("Select", animNames).slider("Delay", 1, 20, 1, 5);
    const response = await form.show(player);
    if (response.canceled) return;
    const anim = animations.get(animNames[response.formValues[0]]);
    player.sendMessage(`§e--- Export ${animNames[response.formValues[0]]} ---`);
    for (let i = 0; i < anim.frames.length; i++) player.sendMessage(`§f/structure load "${anim.frames[i]}" ...`);
}

function showHelp(player) { player.sendMessage("§eRight-Click (P1), Sneak+Right-Click (P2), Punch (Gen Point), Use Air (Menu)"); }
