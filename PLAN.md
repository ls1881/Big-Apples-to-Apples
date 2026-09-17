# Big Apples to Apples

> A century of NYC menus, compared anyway.

## 1. Overview
- Higher-or-lower browser game built on NYPL's "What's on the Menu?" archive
- Each round: two dishes, each with restaurant + year
- Left card shows its price; player guesses if the right card's price is higher or lower
- Correct → streak +1, right card slides left, new dish appears
- Wrong → game over, show final streak and best score
- Personal project, static site, no backend

## 2. Gameplay
### Card contents
- Dish name
- Restaurant (menu sponsor / place)
- Year
- Price (hidden on right card until guess)

### Loop
1. Show left card (price visible) and right card (price hidden)
2. Player picks **Higher** or **Lower**
3. Reveal price + inflation-adjusted fact
4. Correct → shift cards, draw new dish, streak +1
5. Wrong → end screen

### End screen
- Final streak
- Best streak (localStorage)
- Share button (text/emoji summary)
- Play again

## 3. Design Decisions
- **Prices:** show nominal menu prices; show today's-dollars equivalent on reveal
- **Near-ties:** skip pairs within ~10–20% of each other
- **Difficulty ramp:**
  - Early: large price gaps, similar years
  - Later: smaller gaps, far-apart years
- **Fairness:** only use dishes that appear on multiple menus / have reliable data

## 4. Data Pipeline
### Source files
- `Dish.csv`: clean dish names
- `MenuItem.csv`: price, dish ID, menu page ID
- `MenuPage.csv`: links items to menus
- `Menu.csv`: restaurant, date, place, currency

### Steps
1. Download CSVs; confirm dataset is still hosted
2. Join: MenuItem → MenuPage → Menu, plus Dish
3. Filter:
   - [ ] USD only
   - [ ] Year roughly 1850–2010
   - [ ] Non-missing, non-zero prices
   - [ ] Valid restaurant name
   - [ ] Trim price outliers
4. Normalize dish and restaurant names
5. Add CPI-adjusted price column
6. Export `items.json`
7. Hand-check a random sample of ~100 items

### Item schema
- `id`
- `dish`
- `restaurant`
- `year`
- `price`
- `price_today`
- `image_url` (optional)

## 5. Tech Stack
- Python (pandas) for cleaning
- HTML / CSS / JavaScript front end
- `items.json` loaded client-side
- localStorage for best score
- Static hosting (GitHub Pages, Netlify, etc.)

## 6. Build Phases
### Phase 1: Data
- [ ] Cleaning script
- [ ] `items.json` generated
- [ ] Sample spot-checked

### Phase 2: Core Game
- [ ] Two-card layout
- [ ] Higher / Lower buttons
- [ ] Pair selection with near-tie skipping
- [ ] Streak tracking and game over

### Phase 3: Polish
- [ ] Reveal and slide animations
- [ ] Best score in localStorage
- [ ] Difficulty ramp
- [ ] Inflation fact on reveal
- [ ] Share button
- [ ] Mobile layout

### Phase 4: Stretch
- [ ] Menu images (if URLs still resolve)
- [ ] Daily seeded challenge
- [ ] Themed modes (oysters only, one decade, one restaurant)
- [ ] Era / decade filter
- [ ] Fun fact per restaurant

## 7. Risks
- Messy prices (units, currencies, typos)
- Missing or wrong dates
- Duplicate or variant dish names
- Dataset links or image URLs may have moved
- Trademark echo with "Apples to Apples" if published widely

## 8. Credits
- Menu data: New York Public Library, "What's on the Menu?"
- Not affiliated with NYPL or the Apples to Apples card game
