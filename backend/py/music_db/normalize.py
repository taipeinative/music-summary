import re
import unicodedata

WHITELIST = ['接個吻,開一槍', '接个吻,开一枪', 'Angels & Airwaves', 'Jack & Jack', 'Jonathan & Friends', 'Matisse & Sadko', 'Vargas & Lagola']

def parse_artists(input, whitelist: list[str] = WHITELIST, normalize: bool = False) -> list[str]:
    if input is None:
        return []

    if not isinstance(input, str):
        input = str(input)

    protected = {}
    for i in range(len(whitelist)):
        candidate = whitelist[i]
        if candidate in input:
            key = f'--PROTECTED-KEYWORD-{i}--'
            protected[key] = candidate
            input = input.replace(candidate, key)

    parts = re.split(r',|&', input)
    result = []
    for part in parts:
        part = part.strip()
        if part in protected:
            if normalize:
                result.append(normalize_text(protected[part]))
            else:
                result.append(protected[part])
        elif part:
            if normalize:
                result.append(normalize_text(part))
            else:
                result.append(part)
    return result

def normalize_artist(input, whitelist: list[str] = WHITELIST) -> str:
    outputs = parse_artists(input, whitelist, True)
    return ','.join(outputs)

def normalize_title(input) -> str:
    if input is None:
        return ''
    
    if not isinstance(input, str):
        input = str(input)
    
    output = normalize_text(input)
    
    # Matches: _WHITESPACE_(feat. Artist)  [ft. Artist]_WHITESPACE_
    output = re.sub(r'[\(\[\{](?:ft\.?|feat\.?|featuring|with).*[\)\]\}](?:\s*|$)', '', output)

    # Matches: _WHITESPACE[Remix by Artist]  (Artist Mix)_WHITESPACE_
    output = re.sub(r'[\(\[\{].*(?:[Rr][Ee])?[Mm][Ii][Xx].*[\)\]\}](?:\s*|$)', '', output)
    return output

def normalize_text(input) -> str:
    if input is None:
        return ''
    
    if not isinstance(input, str):
        input = str(input)

    # 1. Custom normalization
    output = simplify_punctuation(input)

    # 2. Fallback normalization
    output = unicodedata.normalize('NFKC', output)

    # 3. Lowercase
    output = output.lower()

    # 4. Whitespaces
    output = re.sub(r'\s+', ' ', output).strip()

    return output

def remove_punctuation(text: str) -> str:
    # Should be used after simplify_punctuation().
    text = ''.join([x if not unicodedata.category(x).startswith('P') else ' ' for x in text])

    # Not yet handled: =, ~ and | (category = Sm) plus ° (category = So)
    text = re.sub(r'[=~\|°]', ' ', text)

    # Remove excessive whitespaces
    text = re.sub(r'\s+', ' ', text).strip()

    return text.strip()

def simplify_punctuation(text: str, aggressive: bool = True) -> str:
    # 1. Hyphons, dashes, macrons and underscores (-)
    text = re.sub(r'[\x2D\x5F\xAF\u02C9\u02CD\u02D7\u058A\u05BE\u1427\u1428\u1806\u2010\u2011\u2012\u2013\u2014\u2015\u203E\u2043\u207B\u208B\u2212\u23AF\u23BA\u23BB\u23BC\u23BD\u2500\u2501\u2574\u2576\u2578\u257A\u2E0F\u2E3A\u2E3B\u2E5D\uFE58\uFE63\uFF0D\uFF3F\uFFE3]', '-', text)

    # 2. Equal signs and double hyphens (=)
    text = re.sub(r'[\x3D\u02ED\u1400\u167F\u2017\u207C\u208C\u2E17\u2E40\u30A0\uA78A\uFE66\uFF1D]', '=', text)

    # 3. Tildes (~)
    text = re.sub(r'[\x7E\u02DC\u2053\u223C\u223D\u223E\u223F\u301C\u3030\uFF5E]', '~', text)

    # 4. Vertical bars (|)

    # 4.1 Single (|)
    text = re.sub(r'[\x7C\u2223\u239C\u239F\u23A2\u23A5\u23AA\u23AE\u23B8\u23B9\u23D0\u23FD\u2502\u2503\u2758\u2759\u275A\uFE31\uFE32\uFE33\uFF5C\uFFE8]', '|', text)

    # 4.2 Double (||)
    text = re.sub(r'[\u2225\u23F8]', '|' if aggressive else '||', text)

    # 4.3 Triple (|||)
    text = re.sub(r'[\u2980\u2AF4\u2AFC]', '|' if aggressive else '|||', text)

    # 5. Slashes and backslashes (/)

    # 5.1 Single (/)
    text = re.sub(r'[\x2F\x5C\u2044\u2215\u2216\u2571\u2572\u27CB\u27CD\u29F5\u29F8\u29F9\uFE68\uFF0F\uFF3C]', '/', text)

    # 5.2 Double (//)
    text = re.sub(r'[\u244A\u2AFD]', '/' if aggressive else '//', text)

    # 6. Full stops, dots, middle points and ellipsis (.)

    # 6.1 Single (.)
    text = re.sub(r'[\x2E\xB7\u02D1\u0387\u05BC\u06D4\u0701\u0702\u0F0B\u0F0C\u16EB\u2022\u2024\u2027\u2219\u22C5\u2E31\u2E33\u30FB\uA78F\uFE52\uFF0E\uFF65\U00010101]', '.', text)

    # 6.2 Double (..)
    text = re.sub(r'[\xA8\u2025]', '.' if aggressive else '..', text)

    # 6.3 Triple (...)
    text = re.sub(r'[\u2026\u22EF]', '.' if aggressive else '...', text)

    # 7. Quotation marks, acutes, graves and primes

    # 7.1 Single (')
    text = re.sub(r'[\x27\x60\xB4\u02BC\u02B9\u02CA\u02CB\u02C8\u141F\u1420\u2018\u2019\u201A\u201B\u2032\u2035\u2039\u203A\u275B\u275C\u275F\uFF07]', '\'', text)

    # 7.2 Double ('')
    text = re.sub(r'[\x22\xAB\xBB\u02BA\u201C\u201D\u201E\u201F\u2033\u2036\u275D\u275E\u2E42\uFF02]', '\'' if aggressive else '\'\'', text)

    # 7.3 Triple (''')
    text = re.sub(r'[\u2034\u2037]', '\'' if aggressive else '\'\'\'', text)

    # 7.4 Quadraple ('''')
    text = re.sub(r'[\u2057]', '\'' if aggressive else '\'\'\'\'', text)

    # 8. Parentheses and brackets (( and ))

    # 8.1 Left ( ( )
    text = re.sub(r'[\x28\x5B\x7B\u207D\u208D\u2768\u276A\u276C\u276E\u2770\u2772\u2774\u27E6\u27E8\u27EA\u2983\u2985\u2987\u2989\u298B\u298D\u298F\u2991\u2997\u29D8\u29DA\u29FC\u3008\u300A\u300C\u300E\u3010\u3014\u3016\u3018\u301A\u301D\uFD3E\uFE17\uFE35\uFE37\uFE39\uFE3B\uFE3D\uFE3F\uFE41\uFE43\uFE47\uFF08\uFF3B\uFF5B\uFF5F\uFF62]', '(', text)

    # 8.2 Right ( ) )
    text = re.sub(r'[\x29\x5D\x7D\u207E\u208E\u2769\u276B\u276D\u276F\u2771\u2773\u2775\u27E7\u27E9\u27EB\u2984\u2986\u2988\u298A\u298C\u298E\u2990\u2992\u2998\u29D9\u29DB\u29FD\u3009\u300B\u300D\u300F\u3011\u3015\u3017\u3019\u301B\u301E\u301F\uFD3F\uFE18\uFE36\uFE38\uFE3A\uFE3C\uFE3E\uFE40\uFE42\uFE44\uFE48\uFF09\uFF3D\uFF5D\uFF60\uFF63]', ')', text)

    # 9. Commas and semicolons (,)

    # 9.1 Commas (,)
    text = re.sub(r'[\x2C\u060C\u066B\u201A\u2E32\u2E41\u3001\uFE10\uFE11\uFE50\uFE51\uFF0C\uFF64]', ',', text)

    # 9.2 Semicolons (;)
    text = re.sub(r'[\x3B\u037E\u061B\u1364\u204F\u2E35\uFE14\uFE54\uFF1B]', ',' if aggressive else ';', text)

    # 10. Colons (:)
    text = re.sub(r'[\x3A\u02D0\u0589\u205A\u2236\u2982\uA789\uFE13\uFE55\uFF1A]', ':', text)

    # 11. Question marks (?)
    text = re.sub(r'[\x3F\u061F\u1945\u2E2E\uFE16\uFE56\uFF1F]', '?', text)

    # 12. Exclamation marks (!)
    text = re.sub(r'[\x21\u01C3\u2762\u2763\uFE15\uFE57\uFF01]', '!', text)

    # 13. Ampersands (&)
    text = re.sub(r'[\x26\uFE60\uFF06]', '&', text)

    # 14. Degree signs, circles and rings (°)

    # 14.1 Simple (°)
    text = re.sub(r'[\xB0\xBA\u02DA\u2218\u25CB\u25EF\u26AC\u2B58]', '°', text)

    # 14.2 Complex (°C and °F)
    text = re.sub(r'[\u2103]', '°C', text)
    text = re.sub(r'[\u2109]', '°F', text)

    # 15. Remove neighbor similar symbols (e.g. DISH// -> DISH/)
    if aggressive:
        text = re.sub(r'(\W)\1+', r'\g<1>', text)

    return text