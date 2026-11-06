"""
Spoken / colloquial / Latin-typed vocabulary for Ask the Data, per language (merged into ask_nlu.LEX / MULTI / periods).
Wording here was written by the developer, not a native speaker: have a Tamil, Kannada, Malayalam and Telugu speaker
review it (a wrong word only makes a question go unrecognised, it never runs wrong SQL).
"""
from __future__ import annotations

EXTRA_LEX: dict[str, list[str]] = {
    "seva": [
        "seve", "sevey", "vazhipad", "vazhipadu", "vazhipaadu", "வழிபாடு", "ಸೇವೆ", "വഴിപാട",  # Kerala temples say "vazhipad" for a seva
    ],
    "donation": [
        "denige", "daana", "dhanam", "danam", "kaanikkai", "நன்கொடை", "ದಾನ", "ദാനം", "ദാന", "దానం", "కానుక", "విరాళం",
    ],
    "donor": ["ಸಂಭಾವನೆ ನೀಡಿದ", "ದಾನ ಮಾಡಿದ", "സംഭാവന ചെയ്ത", "സംഭാവന നൽകിയ", "ദാനം ചെയ്ത", "విరాళం ఇచ్చిన", "దానం చేసిన", "donation koduthavar"],
    "hall": ["ಹಾಲ್", "ಕಲ್ಯಾಣ ಮಂಟಪ", "ഓഡിറ്റോറിയം", "ഹാള്‍", "హాల్", "ஹால்", "mandapam", "mantapa"],
    "booking": ["புக்கிங்", "ಬುಕ್", "ബുക്ക്", "బుక్", "புக் "],
    "total": ["டோட்டல்", "mothatham", "ಟೋಟಲ್", "മൊത്തം", "ടോട്ടൽ", "టోటల్"],
    "amount": [
        "evlo", "காசு", "kasu", "panam", "thogai", "rupa", "ದುಡ್ಡು", "duddu", "hana", "mottha", "ಹಣ", "രൂപ", "thuka", "roopa", "dabbu", "entha", "sommu", "రూపాయ",
    ],
    "count": [
        "ethanai", "pannanga", "pannirukanga", "aachu", "aanadhu", "eshtu", "eshtaytu", "ethra", "ethrayaanu", "ennam", "enni", "ennayi", "namodu", "nondani", "dakhalu",
        "ரிஜிஸ்டர்", "ಮಾಡಿದ", "ರಿಜಿಸ್ಟರ್", "ನೋಂದಣಿ", "ದಾಖಲಾದ", "ಆಯಿತು", "ಆಗಿದೆ", "ಆಗಿವೆ", "ചെയ്ത", "നടന്ന", "നടത്തിയ", "രജിസ്റ്റർ", "cheythu", "nadannu",
        "చేసిన", "చేశారు", "జరిగిన", "అయ్యాయి", "అయింది",
    ],
    "highest": [
        "athigam", "romba", "ரொம்ப", "அதிகம்", "ಜಾಸ್ತಿ", "hecchu", "jaasti", "ಹೆಚ್ಚಿನ", "ഏറ്റവും വലിയ", "ettavum", "kooduthal", "కూడిన", "అధిక", "ekkuva", "athyadhika",
    ],
    "devotee": ["bakthar", "bhakthar", "yaar", "yaaru", "ആരാണ്", "ആരാ ", "aaranu", "evaru", "ఎవరి"],
    "list": ["லிஸ்ட்", "ಲಿಸ್ಟ್", "ലിസ്റ്റ്", "లిస్ట్"],
    "latest": ["கடைசி", "லேட்டஸ்ட்", "ಕೊನೆಯ", "ಲೇಟೆಸ್ಟ್", "അവസാന", "ലേറ്റസ്റ്റ്", "తాజా", "లేటెస్ట్"],
    "cancelled": ["கேன்சல்", "ಕ್ಯಾನ್ಸಲ್", "ക്യാൻസൽ", "క్యాన్సిల్"],
    "average": ["ஆவரேஜ்", "ಆವರೇಜ್", "ആവറേജ്", "యావరేజ్"],
    "daywise": ["தினமும்", "ಪ್ರತಿದಿನ", "ದಿನನಿತ್ಯ", "ദിനംപ്രതി", "ప్రతిరోజూ", "రోజూ"],
    "monthwise": ["மாதம் தோறும்", "ஒவ்வொரு மாதம்", "ಪ್ರತಿ ತಿಂಗಳು", "ತಿಂಗಳಿನ", "ഓരോ മാസവും", "മാസംതോറും", "ప్రతి నెల"],
    "upcoming": ["வரப்போகும்", "வரப்போற", "ಬರಲಿರುವ", "ಬರುವ", "വരാനിരിക്കുന്ന", "రాబోయే", "ముందున్న"],
    "types": ["ವಿಧದ", "ഇനങ്ങൾ", "రకమైన"],
}

# phrases meaning one concept or a pair ("how much money" is an amount, not a count)
EXTRA_MULTI: dict[str, set[str]] = {
    "how much": {"amount"}, "எவ்வளவு தொகை": {"amount"}, "எவ்வளவு பணம்": {"amount"}, "எவ்வளவு காசு": {"amount"}, "எவ்ளோ காசு": {"amount"},
    "ಎಷ್ಟು ಹಣ": {"amount"}, "ಎಷ್ಟು ಮೊತ್ತ": {"amount"}, "ಎಷ್ಟು ದುಡ್ಡು": {"amount"},
    "എത്ര തുക": {"amount"}, "എത്ര രൂപ": {"amount"}, "എത്ര പണം": {"amount"},
    "ఎంత మొత్తం": {"amount"}, "ఎంత డబ్బు": {"amount"}, "ఎంత సొమ్ము": {"amount"},
    # "which seva ..." = the seva type
    "எந்த சேவா": {"seva", "types"}, "ಯಾವ ಸೇವ": {"seva", "types"}, "ಯಾವ ಸೇವೆ": {"seva", "types"}, "ಪ್ರತಿ ಸೇವೆ": {"seva", "types"},
    "ഏത് സേവ": {"seva", "types"}, "ഏത് വഴിപാട": {"seva", "types"}, "ഓരോ സേവ": {"seva", "types"}, "ఏ సేవ": {"seva", "types"}, "ప్రతి సేవ": {"seva", "types"},
    "which vazhipad": {"seva", "types"},
}

EXTRA_PERIODS: dict[str, list[str]] = {
    "last_month": ["ಹೋದ ತಿಂಗಳ", "kalede tingalu", "hinda tingalu", "hodha tingalu", "kazhinja masam", "poya masam", "gata nela", "poyina nela", "గత నెల", "పోయిన నెల"],
    "this_month": ["ee tingalu", "ee thingalu", "ee masam", "ee nela"],
    "next_month": ["munde tingalu", "mundina tingalu", "adutha masam", "vache nela", "వచ్చే నెల"],
    "today": ["ಇವತ್ತು", "ಇಂದಿನ", "ivattu", "indu", "ഇന്നത്തെ", "innu", "ఇవాళ", "నేడు", "ee roju", "ivala"],
    "yesterday": ["ninne", "innale", "ninna", "నిన్నటి"],
    "tomorrow": ["naale", "nale", "naalae", "repu"],
    "this_fy": ["ee varsha", "ee varsham", "ఈ ఏడాది", "ee edadi"],
    "last_fy": ["hinda varsha", "kazhinja varsham", "గత ఏడాది", "gata edadi"],
    "this_week": ["ee vara", "ഈ ആഴ്ച്ച", "ee vaaram"],
    "next_week": ["munde vara", "adutha azhcha", "vache vaaram"],
}
