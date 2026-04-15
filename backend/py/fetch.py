import argparse
import sys

import AppleMusic as AM

def main() -> int:
    PROFILES = [
        ('tw', 'zh-Hant-TW'),
        ('tw', 'en-GB'),
        ('cn', 'zh-Hans-CN'),
        ('fr', 'fr-FR'),
        ('jp', 'ja'),
        ('kr', 'ko'),
        ('us', 'en-US')
    ]

    parser = argparse.ArgumentParser(description = 'Fetch an Apple Music playlist to get song details.')
    parser.add_argument('--id', required = True, help = 'Apple Music playlist id.')
    parser.add_argument('--output', required = True, help = 'Output JSON file path.')
    parser.add_argument('--verbose', action = 'store_true', help = 'Verbose output logs.')
    parser.add_argument('--no-token', action = 'store_false', dest = 'use_token', help = 'Fetch data without providing the developer token.')
    parser.add_argument('--profiles', nargs = '*', help = 'Optional region-language pairs. Example: tw zh-Hant-TW us en-US')
    
    if len(sys.argv) == 1:
        parser.print_help()
        return 0
    
    args = parser.parse_args()

    try:
        profiles = args.profiles
        if not profiles:
            profiles = PROFILES
        
        elif isinstance(profiles, list) and len(profiles) % 2 == 0:
            profiles = [(profiles[i], profiles[i+1]) for i in range(len(profiles) // 2)]

        else:
            raise ValueError(f'Invalid --profile input; the number of strings should be divisble by 2.')
        
        if args.use_token:
            DEV_TOKEN = input('> Input Apple Music API developer token: ')
            if DEV_TOKEN == '':
                raise ValueError(f'Without the developer token, the program couldn\'t fetch the Apple Music API.')
            
            songs = AM.gather_data(profiles, DEV_TOKEN, args.id, args.verbose)

        else:
            songs = AM.Alternate.gather_data(profiles, args.id, args.verbose)
        
        AM.dump_data(args.output, songs)
        print(f'> Fetched data have been saved to `{args.output}`.')
    
    except Exception as ex:
        parser.error(str(ex))
        return 2

    return 0

if __name__ == '__main__':
    main()