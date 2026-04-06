# Changelog

## Version 1.1.0

- Added optional **Auto Template Targeting [experimental]** for supported save templates on Foundry V14.
- Included various smaller fixes and polish improvements.

## Version 1.0.0

Complete rework of the Save Tray styling and functionality.

- The Save Tray now supports **Targeted** and **Selected** rows, similar to the system behavior. (#2)
  - **Targeted** creatures are locked in when the chat message is created, matching system behavior.
  - **Selected** creatures update live based on your current selection, also matching system behavior.
  - Rolled saves are stored in a hidden flag. If you reselect a target that has already rolled, its previous roll will be shown again.
  - Clicking the **Damage** button now uses your current targeted/selected creatures and compares them against the save message. If a match is found, the save result is used to determine the damage multiplier.
  - Non-GM users can only see the Targeted row
- Added support for **multiple saves**. Each save now gets its own button.
- Updated styling to better match the system look and feel.
- Removed the "Trash" button and "Clear all targets option", as it is no longer needed with the new workflow.
- Compatibility with FoundryVTT V14

## Version 0.3.2

- Code cleanup and small internal fixes.

## Version 0.3.1

- Added compatibility with the "Hide NPC Names" mod. Thanks to @ddbrown30. (#3)

## Version 0.3.0

- Compatibility with DnD5e 5.3.0.
- Added per-target remove buttons in the Save Tray (visible to GMs and owners).
- Added a “Clear all targets” option to the existing chat message right-click context menu.

## Version 0.2.0

- Added an optional setting to sync damage roll targets and preset damage multipliers based on save results.
- Added localization support.

## Version 0.1.0

- first release
