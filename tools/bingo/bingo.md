# Bingo Generator

## Description

A static, single-player browser bingo application. Players load a JSON dataset containing bingo squares, generate a randomized grid, and play directly in the browser.

The application runs entirely client-side and is hosted as a static website on GitHub Pages. It requires no backend, server, user accounts, multiplayer functionality or external dependencies.

The application initially supports square grids of configurable size (for example, 5×5 or 4×4).

The main features are:
- Seeded grid generation with configurable tag distributions.
- Different square types, including instant and counter squares.
- Square highlighting.
- Automatic game timer and bingo line tracking.
- Automatic saving and restoration of game progress.
- A help section explaining gameplay and the JSON data format.

## Grid generation

The player provides a JSON dataset through a file input. The dataset contains the available squares and the rules used to generate the grid.

The player can enter a numeric seed and click the Generate button to create a new grid.

Generation must be deterministic: the same dataset, configuration and seed must always produce exactly the same grid.

If the seed field is empty, a random seed is generated. The generated seed should then be displayed in the input field so the player can reproduce the grid later.

Use a simple seeded pseudo-random number generator (PRNG). Cryptographically secure randomness is not necessary. Mulberry32 is a suitable choice.

All random operations involved in grid generation must use the seeded PRNG, not `Math.random()`.

### Tag distribution

Each square belongs to exactly one tag.

The dataset defines the exact number of squares to generate for each tag. These numbers are counts, not weights or probabilities.

For example, `"tag1": 15` means exactly 15 squares belonging to `tag1` must appear in the generated grid.

The sum of all tag counts must equal the number of squares required by the grid.

If the sum does not match, generation must fail and display a clear error message.

Squares must be selected randomly from their respective tags, without replacement. The same square must never appear more than once in a grid.

If a tag does not contain enough unique squares to satisfy its requested count, generation must fail with a clear error message.

Squares belonging to tags that are not configured in the tag distribution are excluded from generation.

### Free center square

The JSON configuration can optionally enable a free center square.

When enabled:
- The center square is automatically considered validated.
- It does not require a square from the dataset.
- The number of squares required from the dataset is reduced by one.

A free center square is only valid for grids with an odd number of rows and columns.

## Gameplay

The generated grid is the main element of the interface. Players interact directly with its squares.

There are two types of squares:

**Instant squares**

The classic bingo square. Clicking it validates the square. Clicking it again unvalidates it.

**Counter squares**

These squares require multiple clicks to be validated. They are useful for objectives that require counting, such as finding something a certain number of times.

Each click increments the counter by one. Once the required amount is reached, the square is considered validated.

The current progress should be visible inside the square (for example, `2 / 5`).

Clicking a completed counter resets its progress to zero.

### Square appearance and highlighting

Validated squares must have a colored background and strikethrough text. A checkmark or another visual indicator can also be used.

Squares can independently be highlighted by using a dedicated button or control on each square. Highlighting must not trigger validation or interfere with counter progress.

Highlighted squares should have a striped background.

Highlighting and validation are independent states, meaning a square can be both highlighted and validated.

The appearance of these states must remain distinguishable when combined.

Square descriptions are displayed when hovering over a square on desktop. They must also be accessible through a suitable interaction on touch devices.

### Bingo detection

The application tracks completed bingo lines.

A valid line consists of:
- Any complete horizontal row.
- Any complete vertical column.
- Either of the two main diagonals.

A line is complete when all its squares are validated.

The application must support multiple completed lines simultaneously.

When a line becomes complete, its completion time is recorded.

If a previously completed line becomes incomplete, its completion time is removed. If it becomes complete again, a new completion time is recorded.

Completing one or more lines does not end the game. Completing the entire grid does not end the game either. The player can continue playing and validating or unvalidating squares freely.

## Timer and persistence

The timer starts automatically when a new grid is generated. Its start timestamp is the grid generation timestamp.

There is no need for a manual start or stop button.

The timer must continue accurately when the browser tab is inactive or the page is closed. It must therefore calculate elapsed time using timestamps rather than relying on an incrementing interval counter.

Each completed bingo line has its own recorded completion timestamp. The displayed completion time should represent the elapsed time since the grid was generated.

The application must automatically save the current game state using `localStorage`.

The saved state must contain everything needed to restore the game exactly as it was, including:
- The loaded dataset.
- The grid configuration.
- The generation seed.
- The generated grid and square positions.
- Validation state of every square.
- Counter progress.
- Highlighting state.
- Grid generation timestamp.
- Completed bingo lines and their completion timestamps.

Saving must happen automatically whenever the game state changes.

When the page is opened, the application must automatically attempt to restore the previously saved game.

The grid must be restored exactly as saved. It must never be regenerated when loading a saved game.

If no save exists, the application starts in its initial state.

If a save exists but cannot be loaded because it is corrupted or incompatible, the application should:
- Display an understandable error message.
- Delete the invalid save.
- Start with an empty game state.

The save format should include a version number to make future changes to the application easier to handle.

Loading a new JSON dataset must not overwrite or destroy the current game. The newly loaded dataset is used for the next generation, while the existing game remains playable until a new grid is generated.

The player can use a Clear button to remove the current game and its saved progress. Clearing the game must not remove the currently loaded dataset.

Generating a new grid replaces the current game and its saved progress.

## Interface

The bingo grid must be the main visual element of the page.

The layout should be responsive and adapt to the available screen space. All squares should remain visible simultaneously whenever the viewport allows it.

Grid cells must:
- Have equal dimensions and remain square-shaped.
- Use as much available space as possible.
- Never grow because of long text.
- Truncate or reduce text size when necessary.
- Remain usable on both desktop and mobile devices.

The grid should never exceed the available viewport width.

Other interface elements should be placed beside or below the grid, depending on the available screen space.

Keep the interface simple. The main controls should be:

- A file input for loading the JSON dataset.
- A numeric input for the generation seed.
- A Generate button.
- A Clear button.

Display relevant errors when a dataset cannot be loaded or a grid cannot be generated.

The currently loaded dataset name and the active generation seed should be visible.

The interface must also display the timer and information about completed bingo lines.

Include a Help section accessible from the page. It should explain:
- How to interact with the squares.
- How instant and counter squares work.
- How highlighting works.
- How the timer and bingo line tracking work.
- How to load a dataset and generate a grid.
- The structure and properties of the JSON data file, including a complete example.

The interface should be intuitive without requiring the player to read the help section before playing.

## Data file format

The application uses JSON files to define the available squares and grid generation rules.

The JSON file contains two main properties: `grid` and `squares`.

Example:

```json
{
  "grid": {
    "size": 5,
    "freeSpace": false,
    "tagCounts": {
      "tag1": 15,
      "tag2": 5,
      "tag3": 5
    }
  },
  "squares": [
    {
      "id": "square1",
      "name": "Find a red car",
      "description": "Find any red car",
      "type": "instant",
      "tag": "tag1"
    },
    {
      "id": "square2",
      "name": "Find 3 dogs",
      "description": "Find three different dogs",
      "type": "counter",
      "amount": 3,
      "tag": "tag2"
    }
  ]
}
```

### Grid properties

- `size`: The number of rows and columns. For example, `5` creates a 5×5 grid.
- `freeSpace`: Whether the center square is automatically validated. Defaults to `false` if omitted.
- `tagCounts`: An object defining the exact number of squares to generate for each tag.

The sum of all values in `tagCounts` must equal the total number of grid cells, minus one if a free center square is enabled.

Grid size must be a positive integer. A free center square requires an odd grid size.

### Square properties

Each square has the following properties:

- `id`: A unique identifier for the square.
- `name`: The text displayed inside the square.
- `description`: Optional additional information displayed when hovering over or interacting with the square.
- `type`: The square type. Supported values are `instant` and `counter`.
- `tag`: The tag used to determine the square's generation distribution.
- `amount`: Required only for counter squares. Defines the number of clicks needed to validate the square.

Square IDs must be unique within the dataset.

Counter amounts must be positive integers.

Tags must be strings matching the keys defined in `tagCounts`.

The dataset must contain enough unique squares for every requested tag count.

### Data validation

The application must validate uploaded JSON files before accepting them.

Validation must check:
- Valid JSON syntax.
- Required properties and correct data types.
- Valid grid size and configuration.
- Valid tag counts.
- Unique square IDs.
- Supported square types.
- Valid counter amounts.
- Valid tag references.
- Sufficient unique squares for the requested distribution.

If validation fails, display a clear and useful error message explaining the problem.

The application must never silently ignore invalid configuration or generate an incomplete grid.

## Technical requirements

The application must use vanilla HTML, CSS and JavaScript.

No external libraries, frameworks, packages or dependencies should be imported.

The application must:
- Run entirely in the browser.
- Be deployable as a static website on GitHub Pages.
- Require no backend, server, database or user accounts.
- Use `localStorage` for game persistence.
- Use a seeded PRNG for deterministic generation.
- Work on modern versions of Chrome, Firefox, Safari and Edge, including mobile browsers.

Use semantic HTML and accessible controls. The grid and its interactions should be usable with a keyboard.

Square names and descriptions originate from user-provided JSON files and must always be treated as plain text. Never inject them directly as HTML.

Keep the implementation reasonably simple and avoid unnecessary abstractions.

Separate the main responsibilities of the application logically:
- Dataset loading and validation.
- Grid generation.
- Game state and gameplay logic.
- Interface rendering and user interaction.
- Persistence and restoration.

The generation and gameplay logic should be independent of the interface wherever practical, making them easier to test and maintain.

The page will be deployed alongside other Jekyll pages via GitHub Pages, but this page should not use Jekyll at all and ignore its existence
