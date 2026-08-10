"""Build migrations/nyc-catalog-2026-08.json from the verified spreadsheet.

Coordinates come from the Mapbox geocode pass (all 29 relevance 1.0, all inside
Manhattan). Hours were researched per venue; the sheet has none. Shot types and
descriptions are authored here. Filler missions from the sheet are dropped --
each cut is recorded in CUTS below so the decision is reviewable.
"""
import json, re, unicodedata

GEO = json.load(open('/private/tmp/claude-501/-Users-brandonshi/2cc41abd-c66d-4b2f-8e50-f5a32f6d5091/scratchpad/nyc-geocoded.json'))
GEO_BY_NAME = {g['name']: g for g in GEO}

# Missions dropped as unfilmable filler, with the reason.
CUTS = {
    "Late-Night Slice Line": "atmosphere, not a menu item",
    "Fresh-Milled Flour Callout": "a fact about the dough, not something you can film",
    "Counter Ordering Rush Shot": "atmosphere, not a menu item",
    "Cash-Only Counter Shot": "a payment policy, not a menu item",
    "Outside Line with Umbrellas": "atmosphere, not a menu item",
    "Domino-Game Hangout Shot": "atmosphere, not a menu item",
    "Counter-Order Shot": "atmosphere, not a menu item",
}

H = lambda *d: list(d)          # Sunday-first, seven entries
ALL = lambda s: [s] * 7         # same span every day


def wk(sun, mon, tue, wed, thu, fri, sat):
    return [sun, mon, tue, wed, thu, fri, sat]


# (title, shotType, emoji, difficulty, description)
VENUES = [
    ("Kalye", "Lower East Side", "$$", ALL("11:00-22:00")[:4] + ["11:00-00:00"] * 3, [
        ("BBQ Skewers", "dish", "🍢", "easy", "Film the BBQ skewers. One plated item, one close pass, hold steady."),
        ("Chicken Inasal", "dish", "🍗", "easy", "Film the chicken inasal. Get the char on the skin in one close pass."),
        ("Kinilaw", "dish", "🐟", "easy", "Film the kinilaw. Hold steady and make one close pass over the bowl."),
        ("Kamayan Feast Spread", "spread", "🍤", "medium", "Film the kamayan spread. Show the scale of the whole table first, then pan slowly across it."),
        ("Ube Ice Cream", "dish", "🍨", "easy", "Film the ube ice cream. One close pass, get the colour."),
    ]),
    ("miss KOREA BBQ", "Koreatown", "$$$", ALL("00:00-23:59"), [
        ("Signature Beef Set (Galbi)", "dish", "🥩", "easy", "Film the galbi set. One close pass over the raw beef before it hits the grill."),
        ("Bulgogi", "dish", "🥩", "easy", "Film the bulgogi. Hold steady, one close pass."),
        ("Egg Souffle", "dish", "🍳", "medium", "Film the egg souffle as it rises in the pan. Start before it puffs and don't cut early."),
        ("Kimchi Jjigae", "dish", "🍲", "easy", "Film the kimchi jjigae bubbling. One close pass over the pot."),
        ("Banchan Spread", "spread", "🥢", "medium", "Film the banchan. Show how many dishes there are, then pan slowly across every one."),
    ]),
    ("Shuka", "SoHo", "$$$", wk("10:30-22:00", "12:00-23:00", "12:00-23:00", "12:00-23:00", "12:00-23:00", "12:00-23:00", "10:30-23:00"), [
        ("Whipped Feta & Pistachio", "dish", "🧀", "easy", "Film the whipped feta. One close pass, get the pistachios on top."),
        ("Hummus & Fried Halloumi", "dish", "🫓", "easy", "Film the hummus and halloumi. Hold steady, one close pass."),
        ("Za'atar Fries", "dish", "🍟", "easy", "Film the za'atar fries. One close pass over the plate."),
        ("Falafel", "dish", "🧆", "easy", "Film the falafel. One close pass, get the crust."),
        ("Shrimp & Lamb Merguez", "dish", "🍤", "easy", "Film the shrimp and merguez. Hold steady and make one close pass."),
    ]),
    ("Barbounia", "Flatiron", "$$$", wk("10:30-22:30", "11:30-22:30", "11:30-23:00", "11:30-23:00", "11:30-23:30", "11:30-23:30", "10:30-23:30"), [
        ("Grilled Octopus", "dish", "🐙", "easy", "Film the grilled octopus. One close pass, get the char."),
        ("Kalamata Olive Flatbread", "dish", "🫓", "easy", "Film the flatbread. Hold steady, one close pass."),
        ("Short Rib Tagine", "dish", "🍲", "easy", "Film the tagine. One close pass, ideally as the lid comes off."),
        ("Lamb Chops", "dish", "🍖", "easy", "Film the lamb chops. One close pass over the plate."),
        ("Mezze Sampler", "spread", "🫒", "medium", "Film the mezze. Show the whole spread first, then pan slowly across every dish."),
    ]),
    ("Motek Flatiron", "Flatiron", "$$", wk("10:00-22:00", "11:00-22:00", "11:00-22:00", "11:00-22:00", "11:00-22:00", "11:00-23:00", "10:00-23:00"), [
        ("Lamb Shawarma", "dish", "🥙", "easy", "Film the lamb shawarma. One close pass over the plate."),
        ("Spicy Greek Feta Dip", "dish", "🌶️", "easy", "Film the feta dip. Hold steady, one close pass."),
        ("Pastrami Oven Pita", "dish", "🫓", "easy", "Film the pastrami pita. One close pass, get the fold."),
        ("Hummus with Roasted Eggplant", "dish", "🍆", "easy", "Film the hummus. One close pass over the bowl."),
        ("Falafel", "dish", "🧆", "easy", "Film the falafel. Hold steady, one close pass."),
    ]),
    ("Mitr Thai Restaurant", "Midtown", "$$", wk("11:30-22:15", "11:30-22:15", "11:30-22:15", "11:30-22:15", "11:30-22:15", "11:30-22:45", "11:30-22:45"), [
        ("Roti Massaman", "dish", "🍛", "easy", "Film the massaman with the roti. One close pass over both."),
        ("Pineapple Fried Rice", "dish", "🍍", "easy", "Film the fried rice in its pineapple. One close pass, get the whole shell in frame."),
        ("Green Curry", "dish", "🍲", "easy", "Film the green curry. Hold steady, one close pass."),
        ("Mango Avocado Salad", "dish", "🥭", "easy", "Film the salad. One close pass over the plate."),
        ("Basil Fried Rice", "dish", "🍚", "easy", "Film the basil fried rice. Hold steady, one close pass."),
    ]),
    ("Massawa", "Morningside Heights", "$$", wk("10:30-22:00", "10:30-22:00", "10:30-22:00", "10:30-22:00", "10:30-22:00", "10:30-23:00", "10:30-23:00"), [
        ("Sambusa Duo", "dish", "🥟", "easy", "Film the sambusas. One close pass over the plate."),
        ("Zegeni Stew", "dish", "🍲", "easy", "Film the zegeni. Hold steady, one close pass."),
        ("Fitfit Tebesi", "dish", "🍛", "easy", "Film the fitfit tebesi. One close pass over the plate."),
        ("Vegetable Combo Platter", "spread", "🫓", "medium", "Film the combo platter. Show the scale of the injera first, then pan slowly across every mound."),
        ("Signature Mangotini", "dish", "🍹", "easy", "Film the mangotini. One close pass, get the colour."),
    ]),
    ("Amor Loco", "Midtown", "$$", wk("11:30-23:00", "11:30-23:00", "11:30-23:00", "11:30-00:00", "11:30-00:00", "11:30-00:00", "11:30-00:00"), [
        ("Birria Tacos", "dish", "🌮", "easy", "Film the birria tacos. One close pass, get the consomme dip if you can."),
        ("Al Pastor Tacos", "dish", "🌮", "easy", "Film the al pastor. Hold steady, one close pass."),
        ("Chicken Quesadillas", "dish", "🧀", "easy", "Film the quesadillas. One close pass, get the cheese pull."),
        ("Jalapeno Cheesy Fries", "dish", "🍟", "easy", "Film the cheesy fries. One close pass over the plate."),
        ("Lychee Martini", "dish", "🍸", "easy", "Film the lychee martini. Hold steady, one close pass."),
    ]),
    ("Chi Restaurant & Bar", "Hell's Kitchen", "$$", wk("11:30-22:15", "11:30-22:00", "11:30-00:00", "11:30-00:30", "11:30-00:30", "11:30-00:30", "11:30-00:30"), [
        ("Szechuan Cucumber Salad", "dish", "🥒", "easy", "Film the cucumber salad. One close pass over the plate."),
        ("Truffle Beef Tenderloin", "dish", "🥩", "easy", "Film the tenderloin. Hold steady, one close pass."),
        ("Mapo Tofu", "dish", "🌶️", "easy", "Film the mapo tofu. One close pass, get the chilli oil."),
        ("Lobster Sticky Rice", "dish", "🦞", "easy", "Film the lobster sticky rice. One close pass over the whole dish."),
        ("Brown Sugar Rice Cake", "dish", "🍡", "easy", "Film the rice cake. Hold steady, one close pass."),
    ]),
    ("Loong Ramen", "Battery Park City", "$$", wk("11:00-21:30", "11:00-21:00", "11:00-21:00", "11:00-21:00", "11:00-21:00", "11:00-21:30", "11:00-21:30"), [
        ("Signature Chashu Tonkotsu", "dish", "🍜", "easy", "Film the tonkotsu. One close pass over the bowl before it's stirred."),
        ("Crispy Osaka-Style Chicken Wings", "dish", "🍗", "easy", "Film the wings. Hold steady, one close pass."),
        ("Black Truffle Fries", "dish", "🍟", "easy", "Film the truffle fries. One close pass over the plate."),
        ("Crispy Butterflied Prawns", "dish", "🍤", "easy", "Film the prawns. One close pass, get the crust."),
        ("Filet Mignon with Basil Pesto", "dish", "🥩", "easy", "Film the filet. Hold steady, one close pass."),
    ]),
    ("Myka Greek Frozen Yogurt", "West Village", "$", ALL("11:00-00:00"), [
        ("Greek Froyo with Dubai Chocolate", "dish", "🍦", "easy", "Film the froyo with the Dubai chocolate topping. One close pass, get the drizzle."),
        ("Blood Peach Sorbet", "dish", "🍑", "easy", "Film the sorbet. Hold steady, one close pass."),
        ("Pistachio Spread Bowl", "dish", "🥜", "easy", "Film the pistachio bowl. One close pass over the top."),
        ("Berry Crumble Bowl", "dish", "🫐", "easy", "Film the berry crumble. One close pass, get the texture."),
        ("Topping Bar", "display", "🍓", "medium", "Film the topping bar. One slow pass, keeping the whole counter in frame."),
    ]),
    ("Xing Fu Tang", "East Village", "$", wk("13:00-22:00", "14:00-22:00", "14:00-22:00", "14:00-22:00", "14:00-22:00", "14:00-23:00", "13:00-23:00"), [
        ("Ube Boba Tea", "dish", "🧋", "easy", "Film the ube boba. One close pass, get the layers."),
        ("Peach Oolong Tea", "dish", "🍑", "easy", "Film the peach oolong. Hold steady, one close pass."),
        ("Oreo Ube Milk", "dish", "🥛", "easy", "Film the Oreo ube milk. One close pass over the cup."),
        ("Brown Sugar Boba", "dish", "🧋", "easy", "Film the signature brown sugar boba. One close pass, get the tiger stripes."),
        ("Live Boba-Cooking Station", "action", "🔥", "medium", "Film the boba being cooked at the window. Start before they start and don't cut away early."),
    ]),
    ("Taiyaki NYC", "Chinatown", "$", wk("11:00-22:00", "12:00-22:00", "12:00-22:00", "12:00-22:00", "12:00-22:00", "11:00-22:00", "11:00-22:00"), [
        ("Matcha Taiyaki Cone", "dish", "🍦", "easy", "Film the matcha taiyaki cone. One close pass, get the fish shape."),
        ("Unicorn Taiyaki Cone", "dish", "🦄", "easy", "Film the unicorn cone. Hold steady, one close pass."),
        ("Hojicha-Matcha Swirl", "dish", "🍨", "easy", "Film the hojicha-matcha swirl. One close pass over the top."),
        ("Red Bean Filling", "ritual", "🫘", "medium", "Film the first bite that shows the red bean inside. One take, and film the person doing it."),
        ("Soft-Serve Swirl", "action", "🌀", "medium", "Film the swirl being pulled. Start before the machine does and don't cut early."),
    ]),
    ("Figo il Gelato Italiano", "Nolita", "$", ALL("11:00-00:00"), [
        ("Dubai Chocolate Gelato", "dish", "🍫", "easy", "Film the Dubai chocolate gelato. One close pass, get the pistachio."),
        ("Pistachio Gelato", "dish", "🥜", "easy", "Film the pistachio gelato. Hold steady, one close pass."),
        ("Fig Caramel Gelato", "dish", "🍯", "easy", "Film the fig caramel. One close pass over the scoop."),
        ("Coffee-Pistachio Combo", "dish", "☕", "easy", "Film the coffee-pistachio combo. One close pass, get both colours."),
        ("Gelato Case", "display", "🍨", "medium", "Film the gelato case. One slow pass, keeping the whole case in frame."),
    ]),
    ("The Original Chinatown Ice Cream Factory", "Chinatown", "$", wk("11:00-22:00", "11:00-21:00", "11:00-21:00", "11:00-21:00", "11:00-21:00", "11:00-22:00", "11:00-22:00"), [
        ("Black Sesame Ice Cream", "dish", "⚫", "easy", "Film the black sesame scoop. One close pass, get the colour."),
        ("Lychee Rose Ice Cream", "dish", "🌹", "easy", "Film the lychee rose. Hold steady, one close pass."),
        ("Coconut Ice Cream", "dish", "🥥", "easy", "Film the coconut scoop. One close pass."),
        ("Taro Ice Cream", "dish", "💜", "easy", "Film the taro scoop. One close pass, get the colour."),
        ("Sample-Tasting Ritual", "ritual", "🥄", "medium", "Film someone taking a sample spoon at the counter. One take, and film the person doing it."),
    ]),
    ("Joe's Pizza Broadway", "Midtown", "$", wk("10:00-03:00", "10:00-03:00", "10:00-03:00", "10:00-03:00", "10:00-04:00", "10:00-05:00", "10:00-05:00"), [
        ("Classic Cheese Slice", "dish", "🍕", "easy", "Film the cheese slice. One close pass, get the grease shine."),
        ("Pepperoni Slice", "dish", "🍕", "easy", "Film the pepperoni slice. Hold steady, one close pass."),
        ("The Fold", "ritual", "🤌", "medium", "Film the fold and the first bite. One take, and film the person doing it."),
        ("Whole Pie Reveal", "display", "🥧", "medium", "Film a whole pie coming out. One slow pass, keeping the whole pie in frame."),
    ]),
    ("Scarr's Pizza", "Lower East Side", "$", wk("11:30-23:00", "11:30-23:00", "11:30-23:00", "11:30-23:00", "11:30-00:00", "11:30-02:00", "11:30-02:00"), [
        ("Original Cheese Slice", "dish", "🍕", "easy", "Film the cheese slice. One close pass, get the cheese pull."),
        ("Vodka Pesto Slice", "dish", "🌿", "easy", "Film the vodka pesto slice. Hold steady, one close pass."),
        ("Sicilian Hotboi Slice", "dish", "🌶️", "easy", "Film the Hotboi square. One close pass, get the edge."),
        ("Pizza-Making", "action", "👨‍🍳", "medium", "Film a pie being made behind the counter. Start before they start and don't cut away early."),
    ]),
    ("NY Pizza Suprema", "Chelsea", "$", ALL("10:30-00:00"), [
        ("Tomato Slice", "dish", "🍅", "easy", "Film the tomato slice. One close pass over the slice."),
        ("Fig & Bacon Slice", "dish", "🥓", "easy", "Film the fig and bacon slice. Hold steady, one close pass."),
        ("The Fold", "ritual", "🤌", "medium", "Film the fold and the first bite. One take, and film the person doing it."),
        ("Whole Pie Reveal", "display", "🥧", "medium", "Film a whole pie on the counter. One slow pass, keeping the whole pie in frame."),
    ]),
    ("King Dumplings", "Chinatown", "$", ALL("09:30-22:00"), [
        ("Pork & Chive Fried Dumplings", "dish", "🥟", "easy", "Film the fried dumplings. One close pass, get the crisp bottoms."),
        ("Pork Buns", "dish", "🥖", "easy", "Film the pork buns. Hold steady, one close pass."),
        ("Sesame Pancake with Duck", "dish", "🦆", "easy", "Film the sesame pancake. One close pass over the whole thing."),
        ("Pan-Fried Buns", "dish", "🍳", "easy", "Film the pan-fried buns. One close pass, get the browned side."),
    ]),
    ("Nan Xiang Soup Dumplings", "East Village", "$$", ALL("09:00-02:00"), [
        ("Signature Pork Soup Dumplings", "dish", "🥟", "easy", "Film the basket of pork soup dumplings. One close pass over the steamer."),
        ("Crab Meat & Pork Soup Dumplings", "dish", "🦀", "easy", "Film the crab and pork basket. Hold steady, one close pass."),
        ("Truffle & Pork Soup Dumplings", "dish", "🍄", "easy", "Film the truffle basket. One close pass, get the colour difference."),
        ("Scallion Pancake", "dish", "🧅", "easy", "Film the scallion pancake. One close pass over the plate."),
        ("The Slurp", "ritual", "🥢", "medium", "Film the dumpling being bitten and the soup running out. One take, and film the person doing it."),
    ]),
    ("MATCHA HOUSE", "East Village", "$", wk("closed", "09:00-17:30", "08:00-17:30", "08:00-17:30", "08:00-17:30", "09:00-17:30", "09:00-18:30"), [
        ("Chocolate Matcha", "dish", "🍫", "easy", "Film the chocolate matcha. One close pass, get the layers."),
        ("London Fog Matcha Latte", "dish", "🌫️", "easy", "Film the London fog. Hold steady, one close pass."),
        ("Matchadamia Latte", "dish", "🥛", "easy", "Film the matchadamia latte. One close pass over the cup."),
        ("Live Matcha Whisking", "action", "🍵", "medium", "Film the matcha being whisked. Start before they start and don't cut away early."),
        ("Pastry Case", "display", "🥐", "medium", "Film the pastry case. One slow pass, keeping the whole case in frame."),
    ]),
    ("12 Matcha", "NoHo", "$$", ALL("08:30-17:00"), [
        ("Signature Matcha Latte", "dish", "🍵", "easy", "Film the signature latte. One close pass, get the layers."),
        ("Hojicha Brownie", "dish", "🍫", "easy", "Film the hojicha brownie. Hold steady, one close pass."),
        ("One-on-One Whisking", "action", "🥄", "medium", "Film the drink being whisked in front of you. Start before they start and don't cut away early."),
        ("Matcha Tin Shelf", "display", "🫙", "medium", "Film the retail tins. One slow pass, keeping the whole shelf in frame."),
    ]),
    ("Chanta Casa de Empanadas", "West Village", "$", ALL("11:00-22:00"), [
        ("Onion Empanada", "dish", "🧅", "easy", "Film the onion empanada. One close pass, get the crimp."),
        ("Four Cheese Empanada", "dish", "🧀", "easy", "Film the four cheese. Hold steady, one close pass — get the cheese pull if you break it."),
        ("Caprese Empanada", "dish", "🍅", "easy", "Film the caprese. One close pass over the pastry."),
        ("Alfajores", "dish", "🍪", "easy", "Film the alfajores. One close pass, get the dulce de leche."),
        ("Fresh-Baked Case", "display", "🥟", "medium", "Film the case of empanadas. One slow pass, keeping the whole display in frame."),
    ]),
    ("Titi's Empanadas", "East Village", "$", wk("11:00-23:00", "11:00-23:00", "11:00-23:00", "11:00-23:00", "11:00-23:00", "11:00-02:00", "11:00-02:00"), [
        ("Papa Con Queso Empanada", "dish", "🥔", "easy", "Film the papa con queso. One close pass, get the crimp."),
        ("Empanada Flight", "spread", "🥟", "medium", "Film the flight. Show how many there are, then pan slowly across every one."),
        ("Chopped Cheese", "dish", "🥪", "easy", "Film the chopped cheese. Hold steady, one close pass."),
        ("Guava Cheesecake Empanada", "dish", "🍮", "easy", "Film the guava cheesecake empanada. One close pass over the pastry."),
    ]),
    ("Supermoon Bakehouse", "Lower East Side", "$$", ALL("08:00-22:00"), [
        ("Ube Eclair", "dish", "🍩", "easy", "Film the ube eclair. One close pass, get the colour."),
        ("Creme Brulee Danish", "dish", "🍮", "easy", "Film the creme brulee danish. Hold steady, one close pass over the caramelised top."),
        ("Corn Crunch Cookie", "dish", "🍪", "easy", "Film the corn crunch cookie. One close pass, get the texture."),
        ("Pina Colada Donut", "dish", "🍍", "easy", "Film the pina colada donut. One close pass over the glaze."),
        ("Pastry Case Reveal", "display", "🥐", "medium", "Film the pastry case. One slow pass, keeping the whole case in frame."),
    ]),
    ("Mille-Feuille Bakery Cafe", "Greenwich Village", "$", ALL("07:30-18:00"), [
        ("Classic Croissant", "dish", "🥐", "easy", "Film the croissant. One close pass, get the lamination."),
        ("Ham & Cheese Croissant", "dish", "🥪", "easy", "Film the ham and cheese croissant. Hold steady, one close pass."),
        ("Macarons", "dish", "🍬", "easy", "Film the macarons. One close pass across the row."),
        ("Mille-Feuille", "dish", "🍰", "easy", "Film the mille-feuille. One close pass, get the layers from the side."),
        ("Croissant Lamination", "action", "👐", "hard", "Film the dough being laminated or shaped. Start before they start and don't cut away early."),
    ]),
    ("Le Fournil", "East Village", "$", wk("09:00-15:00", "07:30-18:00", "07:30-18:00", "07:30-18:00", "07:30-18:00", "07:30-18:00", "07:30-18:00"), [
        ("Pistachio Croissant", "dish", "🥐", "easy", "Film the pistachio croissant. One close pass, get the filling."),
        ("Canele", "dish", "🍮", "easy", "Film the canele. Hold steady, one close pass over the dark crust."),
        ("Pain au Chocolat", "dish", "🍫", "easy", "Film the pain au chocolat. One close pass."),
        ("Chouquette", "dish", "🍬", "easy", "Film the chouquettes. One close pass, get the sugar."),
        ("Fresh Baguette Pull", "ritual", "🥖", "medium", "Film a baguette coming out of the oven or off the rack. One take, and film the person doing it."),
    ]),
    ("Fresh From Hell", "Hell's Kitchen", "$", ALL("07:00-20:00"), [
        ("Hell's Kitchen Sink Bowl", "dish", "🥣", "easy", "Film the Kitchen Sink bowl. One close pass over the toppings."),
        ("Classic Acai Bowl", "dish", "🫐", "easy", "Film the classic acai bowl. Hold steady, one close pass."),
        ("Fresh-Pressed Orange Juice", "dish", "🍊", "easy", "Film the orange juice. One close pass, get the colour."),
        ("Coconut Oatmeal Cream Bread", "dish", "🥥", "easy", "Film the coconut bread. One close pass."),
        ("Bowl Assembly", "action", "🥄", "medium", "Film a bowl being built. Start before they start and don't cut away early."),
    ]),
    ("Chelsea Acai Cafe", "Hell's Kitchen", "$", wk("08:00-20:00", "07:00-20:30", "07:00-20:30", "07:00-20:30", "07:00-20:30", "07:00-20:30", "08:00-20:00"), [
        ("Almond Butter Acai Bowl", "dish", "🥜", "easy", "Film the almond butter bowl. One close pass over the toppings."),
        ("Strawberry Banana Smoothie", "dish", "🍓", "easy", "Film the smoothie. Hold steady, one close pass."),
        ("Fresh-Pressed Juice", "dish", "🥤", "easy", "Film the juice. One close pass, get the colour."),
        ("Toppings Bar", "display", "🍯", "medium", "Film the toppings bar. One slow pass, keeping the whole counter in frame."),
    ]),
]


def slugify(text):
    text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode()
    # Drop apostrophes rather than turning them into separators: the existing
    # database record is `scarrs-pizza`, and `scarr-s-pizza` would import as a
    # duplicate venue instead of merging with it.
    text = re.sub(r"['’`]", "", text)
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip('-').lower()
    return re.sub(r"-+", "-", text)


catalog = []
for vi, (name, hood, price, hours, missions) in enumerate(VENUES):
    g = GEO_BY_NAME[name]
    vslug = slugify(name)
    recs = []
    for mi, (title, shot, emoji, diff, desc) in enumerate(missions):
        recs.append({
            "slug": f"{vslug}-{slugify(title)}",
            "title": title,
            "shotType": shot,
            "description": desc,
            "difficulty": diff,
            "emoji": emoji,
            "sortOrder": vi * 10 + mi,
        })
    entry = {
        "venue": {
            "slug": vslug,
            "name": name,
            "address": g['address'],
            "latitude": g['geo']['latitude'],
            "longitude": g['geo']['longitude'],
            "geofenceRadiusMeters": 75,
            "timeZone": "America/New_York",
            "neighborhood": hood,
            "category": g['cuisine'],
            "price": price,
            "hours": hours,
        },
        "missions": recs,
    }
    if g.get('link'):
        entry['venue']['websiteUrl'] = g['link']
    catalog.append(entry)

out = '/Users/brandonshi/platepostjelly/migrations/nyc-catalog-2026-08.json'
json.dump(catalog, open(out, 'w'), indent=2, ensure_ascii=False)
print(f"venues: {len(catalog)}  missions: {sum(len(c['missions']) for c in catalog)}")
print(f"cuts: {len(CUTS)}")
for t, why in CUTS.items():
    print(f"  cut {t!r}: {why}")
