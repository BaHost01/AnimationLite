# KeyframeLite - Minecraft Bedrock Animation Mod

An animation mod for Minecraft Bedrock that allows you to animate blocks using keyframes and generate commands/functions for playback.

## Features
- **Selection Wand**: Select an area of blocks to animate.
- **Keyframe Engine**: Save your selection as a keyframe (Minecraft Structure).
- **Dynamic Playback**: Preview your animation directly in the world.
- **Export to Function**: Get the commands needed to create a permanent `.mcfunction`.

## How to Use

### 1. Setup
- Install the **Behavior Pack (BP)** and **Resource Pack (RP)** in your world.
- **CRITICAL**: Enable **Beta APIs** and **Holiday Creator Features** (if needed for custom items) in your World Settings.

### 2. The Animation Wand
- Use the command `!anim wand` to receive the custom **Animation Wand**.
- **Set Point 1**: Right-Click any block with the wand.
- **Set Point 2**: Sneak + Right-Click any block with the wand.
- **Open Menu**: Right-Click the air (or use the wand without looking at a block).

### 3. Keyframing
- Open the main menu.
- Choose **Save Keyframe**.
- Enter an animation name (e.g., `door_opening`) and a frame index (start at `0`).
- Move the blocks in your world to the next position and repeat, incrementing the frame index each time.

### 4. Playback
- Open the menu and choose **Play Animation**.
- Select your animation, set the delay (in ticks), and optionally check the **Loop** box.
- To stop a looping animation, use the **Stop Animations** button in the main menu.

### 5. Exporting
- Choose **Export to Function** to get a guide on creating permanent `.mcfunction` files for your project, including looping setup.

## Technical Details
- **Structures**: Each frame is saved as a structure named `anim_<name>_f<index>`.
- **Command Generation**: Uses the `/structure` command for maximum compatibility and smooth transitions (including air).
