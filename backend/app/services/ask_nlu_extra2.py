"""New concepts for the second template batch (merged into ask_nlu.LEX / MULTI / weights)."""
from __future__ import annotations

EXTRA_LEX: dict[str, list[str]] = {
    "summary": ["summary", "overview", "dashboard", "at a glance", "snapshot", "what happened", "சுருக்கம்", "ಸಾರಾಂಶ", "സംഗ്രഹം", "సారాంశం"],
    "festival": ["festival", "panchang", "panchanga", "ekadashi", "amavasya", "pournami", "poornima", "special day", "பண்டிகை", "பஞ்சாங்க", "ஏகாதசி", "அமாவாசை",
                 "ಹಬ್ಬ", "ಪಂಚಾಂಗ", "ಏಕಾದಶಿ", "ಅಮಾವಾಸ್ಯೆ", "ഉത്സവം", "പഞ്ചാംഗം", "ഏകാദശി", "അമാവാസി", "పండుగ", "పంచాంగం", "ఏకాదశి", "అమావాస్య"],
    "ledger": ["ledger", "account head", "head of account", "category", "categories", "heads", "லெட்ஜர்", "தலைப்பு", "ಲೆಡ್ಜರ್", "ಖಾತೆ", "ലെഡ്ജർ", "లెడ్జర్"],
    "branch": ["branch", "branches", "mutt", "ledger group", "கிளை", "ಶಾಖೆ", "ശാഖ", "శాఖ"],
    "function": ["function", "event", "events", "occasion", "program", "நிகழ்ச்சி", "விழா", "ಕಾರ್ಯಕ್ರಮ", "ಸಮಾರಂಭ", "പരിപാടി", "కార్యక్రమం"],
    "free": ["free", "available", "vacant", "empty", "availability", "காலி", "காலியாக", "ಖಾಲಿ", "ഒഴിവ്", "ലഭ്യമായ", "ఖాళీ", "అందుబాటులో"],
    "net": ["net", "surplus", "deficit", "profit", "loss", "saving", "savings", "left over", "மீதி", "லாபம்", "ಉಳಿತಾಯ", "ಲಾಭ", "മിച്ചം", "ലാഭം", "మిగులు", "లాభం"],
    "occupancy": ["halls are booked", "hall is booked", "which hall booked", "which halls booked", "booked on", "busy"],
}

EXTRA_MULTI: dict[str, set[str]] = {
    "halls are booked": {"hall", "occupancy"}, "hall is booked": {"hall", "occupancy"}, "which hall booked": {"hall", "occupancy"},
    "which halls booked": {"hall", "occupancy"}, "hall booked": {"hall", "occupancy"},
    "where did we spend": {"payment", "highest"}, "where does our income": {"receipt", "highest"}, "how much did we save": {"net"},
    "who collected": {"staff", "collection"}, "collected by": {"staff", "collection"},
}

HIGH_WEIGHT = {"summary", "festival", "ledger", "branch", "function", "free", "net"}
