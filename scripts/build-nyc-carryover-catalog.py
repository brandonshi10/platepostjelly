"""Build migrations/nyc-catalog-carryover-2026-08.json.

HOURS CORRECTED 2026-08-12. The hours copied from the original 16 records were
wrong for six of the eight venues — The Pastry Box was the worst, recorded as
closed Sunday and open Monday-Tuesday when it is the exact opposite. Every set
below is now from a current listing, not the migration file.

The eight venues kept from the original 16. Coordinates, hours, neighborhood and
price are copied verbatim from their existing verified Convex records -- they
were checked once already and are not re-derived here.

The one exception is Morgenstern's: its 88 W Houston flagship closed in October
2025 and it reopened at 2 Rivington St, so its address, coordinates and hours
are corrected from research rather than copied.

Three of the original eleven are NOT here, because research showed their records
are wrong. See DROPPED below.
"""
import json, re, unicodedata

# Slug rule matches scripts/build-nyc-catalog.py: apostrophes are removed, not
# turned into separators, so slugs match the records already in the database.
def slugify(text):
    text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode()
    text = re.sub(r"['’`]", "", text)
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip('-').lower()
    return re.sub(r"-+", "-", text)


# Excluded pending Brandon's decision, with the evidence.
DROPPED = {
    "limprimerie": "Record says 139 Eldridge St, Manhattan. L'Imprimerie is at 1524 Myrtle Ave, "
                   "Bushwick, Brooklyn, and Yelp lists it CLOSED as of August 2026. Wrong borough "
                   "and likely out of business.",
    "ssam-bar-bang-bar": "Record says 171 Stanton St. Momofuku Ssam Bar closed September 2023 and "
                         "Bang Bar is at Columbus Circle. Nothing by this name operates at 171 Stanton.",
    "beverlys": "Record says 3 Essex St. Beverly's is at 297 Grand St. It is also a cocktail bar "
                "with little food, which is why the other four bar/venue records were dropped.",
}

# sortOrder continues past the 29-venue file, which ends at 284.
BASE_SORT = 300

# venue slug -> (name, address, lat, lon, neighborhood, price, category, hours, missions)
# hours are Sunday-first, seven entries.
VENUES = [
    ("trapizzino", "Trapizzino", "144 Orchard St", 40.7201, -73.9893, "Lower East Side", "$",
     "Roman Sandwich",
     ["11:00-21:30", "12:00-21:00", "12:00-22:00", "12:00-22:00", "12:00-22:30", "12:00-00:00", "11:00-00:00"],
     [
         ("Polpette al Sugo", "dish", "🍅", "easy", "Film the meatball trapizzino. One close pass, get the sauce soaking into the pocket."),
         ("Chicken Cacciatore", "dish", "🍗", "easy", "Film the cacciatore trapizzino. Hold steady, one close pass."),
         ("Eggplant Parmigiana", "dish", "🍆", "easy", "Film the eggplant parmigiana pocket. One close pass over the filling."),
         ("Oxtail Ragu", "dish", "🥩", "easy", "Film the oxtail trapizzino. One close pass, get the ragu."),
         ("Filling the Pocket", "action", "👐", "medium", "Film a trapizzino being cut open and filled. Start before they start and don't cut away early."),
     ]),
    ("economy-candy", "Economy Candy", "108 Rivington St", 40.7195, -73.9883, "Lower East Side", "$",
     "Candy",
     ["11:00-18:00", "11:00-18:00", "11:00-18:00", "11:00-18:00", "11:00-18:00", "11:00-18:00", "11:00-18:00"],
     [
         ("The Candy Wall", "display", "🍬", "medium", "Film the floor-to-ceiling candy wall. One slow pass, keeping as much of it in frame as you can."),
         ("Halvah Counter", "display", "🍯", "medium", "Film the halvah at the counter. One slow pass across the whole case."),
         ("Retro Candy Shelf", "display", "🍭", "medium", "Film the discontinued and retro brands. One slow pass along the shelf."),
         ("Chocolate Bar Wall", "display", "🍫", "medium", "Film the imported chocolate section. One slow pass, keep the whole run in frame."),
     ]),
    ("russ-and-daughters-cafe", "Russ & Daughters Cafe", "127 Orchard St", 40.7203, -73.9893,
     "Lower East Side", "$$", "Appetizing",
     ["08:30-15:30", "08:30-14:30", "08:30-14:30", "08:30-14:30", "08:30-14:30", "08:30-15:30", "08:30-15:30"],
     [
         ("The Classic Board", "spread", "🐟", "medium", "Film the Classic board. Show the whole board first, then pan slowly across the fish, bagel and capers."),
         ("Bagel with Nova Lox", "dish", "🥯", "easy", "Film the bagel and lox. One close pass, get the fish."),
         ("Potato Latkes", "dish", "🥔", "easy", "Film the latkes with the sour cream. Hold steady, one close pass."),
         ("Matzo Ball Soup", "dish", "🍲", "easy", "Film the matzo ball soup. One close pass over the bowl."),
         ("Chocolate Babka French Toast", "dish", "🍞", "easy", "Film the babka french toast. One close pass, get the strawberries on top."),
     ]),
    ("cafe-integral", "Cafe Integral", "149 Elizabeth St", 40.7218, -73.9954, "Nolita", "$", "Coffee",
     ["08:00-16:00", "08:00-16:00", "08:00-16:00", "08:00-16:00", "08:00-16:00", "08:00-16:00", "08:00-16:00"],
     [
         ("Iced Horchata Latte", "dish", "🥛", "easy", "Film the horchata latte. One close pass, get the layers before it's stirred."),
         ("The Olivia", "dish", "☕", "easy", "Film the Olivia. Hold steady, one close pass over the cup."),
         ("Brazilian Cheesy Bread", "dish", "🧀", "easy", "Film the pao de queijo. One close pass, break one open if you can."),
         ("Nicaraguan Pour-Over", "action", "💧", "medium", "Film the pour-over being made. Start before the water hits and don't cut away early."),
     ]),
    ("the-pastry-box", "The Pastry Box", "515 E 12th St", 40.7287, -73.9819, "East Village", "$", "Bakery",
     ["10:30-17:00", "closed", "closed", "11:00-19:00", "11:00-19:00", "10:30-19:00", "10:30-19:00"],
     [
         ("Quarter-Pound Sea Salt Chocolate Chip Cookie", "dish", "🍪", "easy", "Film the quarter-pound cookie. One close pass, get the sea salt and the thin edge."),
         ("Black and White Cookie", "dish", "⚫", "easy", "Film the black and white. Hold steady, one close pass."),
         ("Brownie", "dish", "🍫", "easy", "Film the brownie. One close pass, get the crust."),
         ("The Cookie Snap", "ritual", "✋", "medium", "Film the cookie being broken in half. One take, and film the person doing it."),
     ]),
    ("librae-bakery", "Librae Bakery", "35 Cooper Sq", 40.7281, -73.9909, "East Village", "$$", "Bakery",
     ["08:00-17:00", "07:30-16:30", "07:30-16:30", "07:30-16:30", "07:30-16:30", "07:30-16:30", "08:00-17:00"],
     [
         ("Rose Pistachio Croissant", "dish", "🌹", "easy", "Film the rose pistachio croissant. One close pass, get the pistachio and the rose petals."),
         ("Loomi Babka Bun", "dish", "🍋", "easy", "Film the loomi babka bun. Hold steady, one close pass."),
         ("Chocolate Halva Croissant", "dish", "🍫", "easy", "Film the halva croissant. One close pass over the top."),
         ("Marmite Cheddar Morning Bun", "dish", "🧀", "easy", "Film the marmite cheddar bun. One close pass, get the cheese."),
         ("Pastry Case", "display", "🥐", "medium", "Film the pastry case. One slow pass, keeping the whole case in frame."),
     ]),
    ("dimes", "Dimes", "49 Canal St", 40.7148, -73.992, "Lower East Side", "$$", "Restaurant",
     ["09:00-22:00", "08:00-23:00", "08:00-23:00", "08:00-23:00", "08:00-23:00", "08:00-23:00", "09:00-23:00"],
     [
         ("Salmon Bowl", "dish", "🐟", "easy", "Film the salmon bowl. One close pass over the whole bowl."),
         ("Pozole", "dish", "🌶️", "easy", "Film the pozole. Hold steady, one close pass."),
         ("Black Sesame Toast", "dish", "🖤", "easy", "Film the black sesame toast. One close pass, get the colour."),
         ("Sticky Miso Chicken", "dish", "🍗", "easy", "Film the miso chicken. One close pass over the plate."),
         ("Maca Matcha", "dish", "🍵", "easy", "Film the maca matcha. Hold steady, one close pass."),
     ]),
    # Address, coordinates and hours corrected: the 88 W Houston flagship closed
    # in October 2025 and Morgenstern's reopened at 2 Rivington St, noon-midnight
    # daily. The record carried over from the original 16 points at the dead shop.
    #
    # The slug is deliberately `morgensterns-rivington`, not `morgensterns`. The
    # importer reuses an existing place when a venue's slug matches an existing
    # mission's restaurantTag, and the place behind `morgensterns` is the closed
    # W Houston address. A distinct slug creates a new place at the real one
    # instead of hanging correct missions off a dead location.
    ("morgensterns-rivington", "Morgenstern's", "2 Rivington St", 40.72159, -73.993042, "Lower East Side", "$",
     "Ice Cream",
     ["12:00-00:00", "12:00-00:00", "12:00-00:00", "12:00-00:00", "12:00-00:00", "12:00-00:00", "12:00-00:00"],
     [
         ("Burnt Honey Vanilla", "dish", "🍯", "easy", "Film the burnt honey vanilla scoop. One close pass, get the texture."),
         ("Salt & Pepper Pine Nut", "dish", "🌰", "easy", "Film the salt and pepper pine nut. Hold steady, one close pass."),
         ("King Kong Banana Split", "spread", "🍌", "medium", "Film the banana split. Show the whole thing first, then pan slowly across every element."),
         ("Chocolate Deluxe", "dish", "🍫", "easy", "Film the Chocolate Deluxe. One close pass over the top."),
         ("The Scoop Pull", "action", "🍨", "medium", "Film a scoop being pulled from the tub. Start before the scoop goes in and don't cut away early."),
     ]),
]

catalog = []
for vi, (vslug, name, address, lat, lon, hood, price, category, hours, missions) in enumerate(VENUES):
    recs = []
    for mi, (title, shot, emoji, diff, desc) in enumerate(missions):
        recs.append({
            "slug": f"{vslug}-{slugify(title)}",
            "title": title,
            "shotType": shot,
            "description": desc,
            "difficulty": diff,
            "emoji": emoji,
            "sortOrder": BASE_SORT + vi * 10 + mi,
        })
    catalog.append({
        "venue": {
            "slug": vslug,
            "name": name,
            "address": address,
            "latitude": lat,
            "longitude": lon,
            "geofenceRadiusMeters": 75,
            "timeZone": "America/New_York",
            "neighborhood": hood,
            "category": category,
            "price": price,
            "hours": hours,
        },
        "missions": recs,
    })

out = '/Users/brandonshi/platepostjelly/migrations/nyc-catalog-carryover-2026-08.json'
json.dump(catalog, open(out, 'w'), indent=2, ensure_ascii=False)
print(f"venues: {len(catalog)}  missions: {sum(len(c['missions']) for c in catalog)}")
print(f"\nexcluded pending review: {len(DROPPED)}")
for slug, why in DROPPED.items():
    print(f"  {slug}: {why}")
