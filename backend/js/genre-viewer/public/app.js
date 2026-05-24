const SUB_GENRE_MAP = {
    'Bass.ColorBass': 'Color Bass',
    'Bass.FutureBass': 'Future Bass',
    'Bass.KawaiiBass': 'Kawaii Future Bass',
    'Bass.MelodicBass': 'Melodic Bass',
    'Downtempo': 'Downtempo',
    'DrumNBass': 'Drum and Bass',
    'Dubstep.Brostep': 'Brostep',
    'Dubstep.Chillstep': 'Chillstep',
    'Dubstep.MelodicDubstep': 'Melodic Dubstep',
    'Dubstep.Riddim': 'Riddim',
    'Funk': 'Funk',
    'GlitchHop': 'Glitch Hop',
    'Hard.Artcore': 'Artcore',
    'Hard.FutureCore': 'Future Core',
    'Hard.HappyCore': 'Happy Core',
    'Hard.Hardcore': 'Hardcore',
    'Hard.HardStyle': 'Hardstyle',
    'Hard.JCore': 'J-Core',
    'House.AmbientHouse': 'Ambient House',
    'House.Complextro': 'Complextro',
    'House.ElectroHouse': 'Electro House',
    'House.FutureHouse': 'Future House',
    'House.ProgressiveHouse': 'Progressive House',
    'House.SlapHouse': 'Slap House',
    'House.TropicalHouse': 'Tropical House',
    'Jazz': 'Jazz',
    'Lo-fi': 'Lo-fi',
    'Alternative': 'Alternative Rock', // from Rock.Alternative
    'Metal': 'Metal',
    'Soft': 'Soft Rock',
    'Synthwave': 'Synthwave',
    'Trance': 'Trance',
    'Trap': 'Trap'
};

const GENERIC_GENRES = [
    'Classical', 'Country', 'Dance', 'Hip Hop/Rap', 
    'Instrumental', 'Pop', 'R&B/Soul', 'Rock'
];

let allTracks = [];
const groupedData = {
    subgenres: {},
    generics: {},
    unspecified: []
};

// Initialize groups
Object.values(SUB_GENRE_MAP).forEach(name => {
    groupedData.subgenres[name] = [];
});
// Need a generic place to accumulate generic genres dynamically since we use the 'genre' field
// Generic genres will just be populated dynamically

async function fetchTracks() {
    try {
        const response = await fetch('/api/tracks');
        if (!response.ok) throw new Error('Failed to fetch tracks');
        
        allTracks = await response.json();
        processGroups(allTracks);
        renderSidebar();
        
        // Show all tracks by default
        renderResults('All Tracks', allTracks);
    } catch (err) {
        console.error(err);
        document.getElementById('results').innerHTML = '<p>Error loading tracks.</p>';
    }
}

function processGroups(tracks) {
    tracks.forEach(track => {
        let matchedSomething = false;

        // 1. Check subgenres in genre_tag
        if (track.genre_tag) {
            const tags = track.genre_tag.split(',').map(s => s.trim());
            tags.forEach(tag => {
                if (SUB_GENRE_MAP[tag]) {
                    groupedData.subgenres[SUB_GENRE_MAP[tag]].push(track);
                    matchedSomething = true;
                }
            });
        }
        
        // 2. If no subgenre, use generic genre
        if (!matchedSomething && track.genre && track.genre.trim() !== "") {
            const gen = track.genre.trim();
            if (!groupedData.generics[gen]) {
                groupedData.generics[gen] = [];
            }
            groupedData.generics[gen].push(track);
            matchedSomething = true;
        }

        // 3. Unspecified
        if (!matchedSomething) {
            groupedData.unspecified.push(track);
        }
    });
}

function renderSidebar() {
    const list = document.getElementById('genre-list');
    list.innerHTML = '';
    
    // "All Tracks" button
    const allLi = document.createElement('li');
    const allDiv = document.createElement('div');
    allDiv.className = 'nav-item nav-item-generic active';
    allDiv.textContent = 'All Tracks';
    allDiv.onclick = () => {
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        allDiv.classList.add('active');
        renderResults('All Tracks', allTracks);
    };
    allLi.appendChild(allDiv);
    list.appendChild(allLi);
    
    const tree = {};
    for (const [key, val] of Object.entries(SUB_GENRE_MAP)) {
        let parts = key.split('.');
        if (['Alternative', 'Metal', 'Soft'].includes(key)) {
            if (!tree['Rock']) tree['Rock'] = { isCategory: true, items: [] };
            tree['Rock'].items.push(val);
        } else if (parts.length > 1) {
            const top = parts[0];
            if (!tree[top]) tree[top] = { isCategory: true, items: [] };
            tree[top].items.push(val);
        } else {
            tree[key] = { isCategory: false, items: [val] };
        }
    }
    
    Object.keys(tree).sort().forEach(top => {
        if (tree[top].isCategory) {
            const categoryHeader = document.createElement('li');
            const hSpan = document.createElement('span');
            hSpan.className = 'genre-header';
            hSpan.textContent = top;
            categoryHeader.appendChild(hSpan);
            list.appendChild(categoryHeader);
            
            tree[top].items.sort().forEach(sub => {
                list.appendChild(createNavItem(sub, groupedData.subgenres[sub] || [], false));
            });
        } else {
            // Standalone subgenre
            const standaloneName = tree[top].items[0];
            list.appendChild(createNavItem(standaloneName, groupedData.subgenres[standaloneName] || [], true));
        }
    });

    // Generic
    const genHeader = document.createElement('li');
    const genSpan = document.createElement('span');
    genSpan.className = 'genre-header';
    genSpan.textContent = 'Generic';
    genHeader.appendChild(genSpan);
    list.appendChild(genHeader);
    
    Object.keys(groupedData.generics).sort().forEach(gen => {
        list.appendChild(createNavItem(gen, groupedData.generics[gen], false));
    });

    // Unspecified
    list.appendChild(createNavItem('Unspecified', groupedData.unspecified, true));
}

function createNavItem(name, tracks, isHeaderLike = false) {
    const li = document.createElement('li');
    const div = document.createElement('div');
    div.className = 'nav-item';
    if (isHeaderLike) div.classList.add('nav-item-generic');
    
    div.textContent = `${name} (${tracks.length})`;
    
    div.onclick = () => {
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        div.classList.add('active');
        renderResults(name, tracks);
    };
    
    li.appendChild(div);
    return li;
}

let currentTitle = '';
let currentTracks = [];
let sortMode = 0; // 0 = legacy_id (default), 1 = title asc, 2 = title desc

function renderResults(title, tracks) {
    currentTitle = title;
    currentTracks = tracks;
    
    document.getElementById('view-title').textContent = title;
    document.getElementById('view-count').textContent = `${tracks.length} tracks`;
    const resultsGrid = document.getElementById('results');
    resultsGrid.innerHTML = '';
    
    // Check if empty
    if (tracks.length === 0) {
        resultsGrid.innerHTML = '<p class="meta">No tracks found.</p>';
        return;
    }
    
    // Process sort
    let displayTracks = [...tracks];
    if (sortMode === 1) {
        displayTracks.sort((a, b) => (a['name 2512'] || '').localeCompare(b['name 2512'] || ''));
    } else if (sortMode === 2) {
        displayTracks.sort((a, b) => (b['name 2512'] || '').localeCompare(a['name 2512'] || ''));
    } else {
        displayTracks.sort((a, b) => parseInt(a.legacy_id) - parseInt(b.legacy_id));
    }

    const placeholderSvg = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="110" height="110" fill="#ddd"><rect width="110" height="110" fill="#f0f0f0"/><path d="M55 35a20 20 0 100 40 20 20 0 000-40z" fill="#ccc"/></svg>');
    
    displayTracks.forEach(t => {
        const card = document.createElement('div');
        card.className = 'track-card';
        
        let imgUrl = placeholderSvg;
        if (t.album_artwork) {
            imgUrl = `https://is1-ssl.mzstatic.com/image/thumb/${t.album_artwork}/220x220bb.webp`;
        }
        
        const titleText = t['name 2512'] || 'Unknown track';
        const artistText = t['artist_label'] || t['artist_primary 2512'] || 'Unknown Artist';
        const releaseYear = t['release_date'] ? t['release_date'].substring(0, 4) : '';
        
        card.innerHTML = `
            <img class="track-img" src="${imgUrl}" alt="Artwork" loading="lazy">
            <div class="track-info">
                <div class="track-title" title="${titleText}">${titleText}</div>
                <div class="track-artist" title="${artistText}">${artistText}</div>
                <div class="track-date">${releaseYear}</div>
            </div>
        `;
        
        card.addEventListener('click', () => showMetadata(t, imgUrl));
        resultsGrid.appendChild(card);
    });
}

const audioCache = {};

async function showMetadata(t, imgUrl) {
    const panel = document.getElementById('metadata-panel');
    const content = document.getElementById('metadata-content');
    
    const titleText = t['name 2512'] || 'Unknown track';
    const amIds = t.apple_music ? t.apple_music.split(',').map(s => s.trim()) : [];
    
    let titleHtml = titleText;
    let appleMusicId = null;
    if (amIds.length > 0) {
        // use last (biggest) id
        appleMusicId = amIds[amIds.length - 1];
        titleHtml = `<a href="https://music.apple.com/tw/song/${appleMusicId}?l=en-GB" target="_blank">${titleText}</a>`;
    }
    
    let artistHtml = '';
    const artistsNames = (t.artist_label || t['artist_primary 2512'] || 'Unknown').split(',').map(s => s.trim());
    const artistsIds = t.artist ? t.artist.split(',').map(s => s.trim()) : [];
    
    const artistLinks = artistsNames.map((name, i) => {
        const id = artistsIds[i];
        if (id && id !== '0') {
            return `<a href="https://music.apple.com/tw/artist/${id}?l=en-GB" target="_blank">${name}</a>`;
        }
        return name;
    });
    artistHtml = artistLinks.join(', ');

    const album = t['album 2512'] || 'Unknown Album';
    const releaseYear = t.release_date ? t.release_date.substring(0, 4) : 'Unknown';
    const genre = t.genre || 'None';
    
    const subgenresArr = t.genre_tag ? t.genre_tag.split(',').map(s => s.trim()).filter(s => SUB_GENRE_MAP[s]).map(s => SUB_GENRE_MAP[s]) : [];
    const subgenres = subgenresArr.length > 0 ? subgenresArr.join(', ') : 'None';
    
    content.innerHTML = `
        <img class="meta-img" src="${imgUrl}" alt="Artwork">
        <div id="audio-container"></div>
        <div class="meta-item">
            <span class="meta-label">Title</span>
            <div class="meta-value">${titleHtml}</div>
        </div>
        <div class="meta-item">
            <span class="meta-label">Artist</span>
            <div class="meta-value">${artistHtml}</div>
        </div>
        <div class="meta-item">
            <span class="meta-label">Album</span>
            <div class="meta-value" id="meta-album-val">${album}</div>
        </div>
        <div class="meta-item">
            <span class="meta-label">Year</span>
            <div class="meta-value">${releaseYear}</div>
        </div>
        <div class="meta-item">
            <span class="meta-label">Genre</span>
            <div class="meta-value">${genre}</div>
        </div>
        <div class="meta-item">
            <span class="meta-label">Subgenres</span>
            <div class="meta-value">${subgenres}</div>
        </div>
    `;
    
    panel.classList.add('open');

    // Fetch Audio
    if (appleMusicId) {
        const audioContainer = document.getElementById('audio-container');
        if (audioCache[appleMusicId]) {
            const cacheData = audioCache[appleMusicId];
            renderAudioPlayer(audioContainer, cacheData.url);
            updateAlbumLink(cacheData.collectionId, album);
        } else {
            try {
                const res = await fetch(`https://itunes.apple.com/lookup?media=music&entity=musicTrack&country=tw&id=${appleMusicId}`);
                const data = await res.json();
                if (data.results && data.results.length > 0 && data.results[0].previewUrl) {
                    const trackData = data.results[0];
                    const audioUrl = trackData.previewUrl;
                    const collectionId = trackData.collectionId;
                    audioCache[appleMusicId] = { url: audioUrl, collectionId: collectionId };
                    renderAudioPlayer(audioContainer, audioUrl);
                    updateAlbumLink(collectionId, album);
                }
            } catch (e) {
                console.error('Failed to fetch preview URL: ', e);
            }
        }
    }
}

function updateAlbumLink(collectionId, albumName) {
    if (collectionId) {
        const albumVal = document.getElementById('meta-album-val');
        if (albumVal) {
            albumVal.innerHTML = `<a href="https://music.apple.com/tw/album/${collectionId}?l=en-GB" target="_blank">${albumName}</a>`;
        }
    }
}

function renderAudioPlayer(container, src) {
    container.innerHTML = `
        <div class="custom-player">
            <audio id="custom-audio" src="${src}"></audio>
            <button id="play-pause-btn" class="play-btn">
                <svg id="play-icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                <svg id="pause-icon" viewBox="0 0 24 24" style="display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            </button>
            <div class="timeline-container" id="timeline-container">
                <div class="timeline-progress" id="timeline-progress"></div>
            </div>
            <div class="time-indicator" id="time-indicator">0:00 / 0:30</div>
        </div>
    `;
    
    const audio = document.getElementById('custom-audio');
    const playBtn = document.getElementById('play-pause-btn');
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');
    const timeline = document.getElementById('timeline-container');
    const progress = document.getElementById('timeline-progress');
    const timeInd = document.getElementById('time-indicator');
    
    const formatTime = (time) => {
        if (isNaN(time)) return '0:00';
        const m = Math.floor(time / 60);
        const s = Math.floor(time % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };
    
    playBtn.addEventListener('click', () => {
        if (audio.paused) {
            audio.play();
            playIcon.style.display = 'none';
            pauseIcon.style.display = 'block';
        } else {
            audio.pause();
            playIcon.style.display = 'block';
            pauseIcon.style.display = 'none';
        }
    });
    
    audio.addEventListener('timeupdate', () => {
        const cur = audio.currentTime;
        const dur = audio.duration;
        if (dur) {
            progress.style.width = `${(cur / dur) * 100}%`;
            timeInd.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
        }
    });
    
    audio.addEventListener('loadedmetadata', () => {
         timeInd.textContent = `0:00 / ${formatTime(audio.duration)}`;
    });
    
    audio.addEventListener('ended', () => {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
        progress.style.width = '0%';
        timeInd.textContent = `0:00 / ${formatTime(audio.duration)}`;
    });
    
    timeline.addEventListener('click', (e) => {
        const rect = timeline.getBoundingClientRect();
        const clickPos = e.clientX - rect.left;
        const perc = clickPos / rect.width;
        if (audio.duration) {
            audio.currentTime = perc * audio.duration;
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    fetchTracks();
    
    // View Toggle Logic
    const viewToggleBtn = document.getElementById('view-toggle');
    const resultsContainer = document.getElementById('results');
    const iconList = document.getElementById('icon-list');
    const iconGrid = document.getElementById('icon-grid');
    
    let isGridView = true; // default
    
    viewToggleBtn.addEventListener('click', () => {
        isGridView = !isGridView;
        if (isGridView) {
            resultsContainer.className = 'results-grid';
            iconList.style.display = 'block';
            iconGrid.style.display = 'none';
        } else {
            resultsContainer.className = 'results-list';
            iconList.style.display = 'none';
            iconGrid.style.display = 'block';
        }
    });

    // Sort Toggle Logic
    const sortToggleBtn = document.getElementById('sort-toggle');
    const iconSortDefault = document.getElementById('icon-sort-default');
    const iconSortAsc = document.getElementById('icon-sort-asc');
    const iconSortDesc = document.getElementById('icon-sort-desc');
    
    sortToggleBtn.addEventListener('click', () => {
        sortMode = (sortMode + 1) % 3;
        
        iconSortDefault.style.display = sortMode === 0 ? 'block' : 'none';
        iconSortAsc.style.display = sortMode === 1 ? 'block' : 'none';
        iconSortDesc.style.display = sortMode === 2 ? 'block' : 'none';
        
        const titles = ['Cycle Sort (Default)', 'Cycle Sort (Title Asc)', 'Cycle Sort (Title Desc)'];
        sortToggleBtn.title = titles[sortMode];
        
        renderResults(currentTitle, currentTracks);
    });

    // Info Panel Toggle Logic
    const infoToggleBtn = document.getElementById('info-toggle');
    const metadataPanel = document.getElementById('metadata-panel');
    
    infoToggleBtn.addEventListener('click', () => {
        metadataPanel.classList.toggle('open');
    });
});
