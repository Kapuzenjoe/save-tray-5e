# Save Tray 5e

![Static Badge](https://img.shields.io/badge/Foundry-v13--14-informational)
![Static Badge](https://img.shields.io/badge/Dnd5e-v5.2-informational)
![Static Badge](https://img.shields.io/badge/Dnd5e-v5.3-informational)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/peterlankton86911)

**Save Tray 5e** is a lightweight module that enhances D&D 5e saving throw chat messages by adding a compact **Save Tray**, similar to the system’s damage tray for applying damage. It displays **targeted** creatures for all users and **selected** creatures for GMs, along with their save results in a clear, system-like layout.

Targeted creatures are locked in when the chat message is created, while selected creatures update dynamically based on the GM's current selection. Save results are stored internally, allowing previously rolled saves to be restored when a creature is reselected. Players can roll their own saves directly from targeted tray entries they own, and the tray updates automatically as rolls come in.

The module also supports **multiple saves**, with a separate button for each save.

Optionally, the module can use the current targeted creatures, or the GM's current selection, when applying damage and automatically determine the correct damage multiplier based on the recorded save result (full, half, or no damage).

This module is intended as a possible workaround for the related D&D 5e system issue https://github.com/foundryvtt/dnd5e/issues/3897

![Example 1](docs/example-1.png)