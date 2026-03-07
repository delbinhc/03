// Cuevana3 Spider for CatVod
// API: https://cue.cuevana3.nu/wp-json/cuevana/v1/

var API_HOST = 'https://cue.cuevana3.nu/wp-json/cuevana/v1';

function init(ext) {
    // ext contiene parámetros adicionales si se proporcionan
    return "";
}

function homeContent(filter) {
    var url = API_HOST + '/home';
    var resp = fetch(url);
    var json = JSON.parse(resp);
    
    var result = {
        "class": [
            {"type_id": "movies", "type_name": "Películas"},
            {"type_id": "series", "type_name": "Series"},
            {"type_id": "estrenos", "type_name": "Estrenos"},
            {"type_id": "tendencias", "type_name": "Tendencias"}
        ],
        "filters": {
            "movies": [
                {
                    "key": "genre",
                    "name": "Género",
                    "value": [
                        {"n": "Todos", "v": ""},
                        {"n": "Acción", "v": "accion"},
                        {"n": "Comedia", "v": "comedia"},
                        {"n": "Drama", "v": "drama"},
                        {"n": "Terror", "v": "terror"},
                        {"n": "Ciencia Ficción", "v": "ciencia-ficcion"},
                        {"n": "Romance", "v": "romance"},
                        {"n": "Suspense", "v": "suspense"}
                    ]
                }
            ]
        },
        "list": []
    };
    
    if (json.data && json.data.length > 0) {
        json.data.forEach(function(item) {
            var video = parseVideo(item);
            if (video) result.list.push(video);
        });
    }
    
    return JSON.stringify(result);
}

function homeVideoContent() {
    return homeContent(false);
}

function categoryContent(tid, pg, filter, extend) {
    var url = '';
    var page = parseInt(pg) || 1;
    
    if (tid === 'movies') {
        url = API_HOST + '/moviespage';
    } else if (tid === 'series') {
        url = API_HOST + '/seriespage';
    } else if (tid === 'estrenos') {
        url = API_HOST + '/estrenos';
    } else if (tid === 'tendencias') {
        url = API_HOST + '/tendencias?paged=' + page;
    } else {
        url = API_HOST + '/moviespage';
    }
    
    var resp = fetch(url);
    var json = JSON.parse(resp);
    
    var result = {
        "page": page,
        "pagecount": parseInt(json.total_pages) || 1,
        "limit": 20,
        "list": []
    };
    
    if (json.data && json.data.length > 0) {
        json.data.forEach(function(item) {
            var video = parseVideo(item);
            if (video) result.list.push(video);
        });
    }
    
    return JSON.stringify(result);
}

function detailContent(ids) {
    var id = ids[0];
    var url = API_HOST + '/single?id=' + id;
    
    var resp = fetch(url);
    var json = JSON.parse(resp);
    
    var result = {"list": []};
    
    if (json.data) {
        var item = json.data;
        var info = item.info || {};
        
        var video = {
            "vod_id": info._id || id,
            "vod_name": item.title || '',
            "vod_pic": info.cover ? 'https://image.tmdb.org/t/p/w500' + info.cover : '',
            "vod_remarks": info.ratingValue || '',
            "vod_director": info.director ? info.director.map(function(d) { return d[0]; }).join(', ') : '',
            "vod_actor": info.cast ? info.cast.map(function(c) { return c[0]; }).join(', ') : '',
            "vod_content": info.desc || '',
            "vod_year": info.release ? info.release.substring(0, 4) : '',
            "type_name": info.type === 'tv' ? 'Series' : 'Películas',
            "vod_play_from": "",
            "vod_play_url": ""
        };
        
        // Géneros
        if (info.genres && info.genres.length > 0) {
            video.type_id = String(info.genres[0][2]);
            video.vod_tag = info.genres.map(function(g) { return g[0]; }).join(', ');
        }
        
        // Obtener player
        var playFrom = [];
        var playUrl = [];
        
        try {
            var playerUrl = API_HOST + '/player/' + id;
            var playerResp = fetch(playerUrl);
            var playerJson = JSON.parse(playerResp);
            
            if (playerJson.data && playerJson.data.embeds) {
                playerJson.data.embeds.forEach(function(embed) {
                    playFrom.push(embed.server);
                    playUrl.push(embed.quality + '$' + embed.url);
                });
            }
        } catch(e) {
            print('Error getting player: ' + e);
        }
        
        video.vod_play_from = playFrom.join('$$$');
        video.vod_play_url = playUrl.join('$$$');
        
        result.list.push(video);
    }
    
    return JSON.stringify(result);
}

function searchContent(key, quick) {
    var result = {"list": []};
    // La API de búsqueda de Cuevana3 requiere formato específico
    // Por ahora devolvemos vacío
    return JSON.stringify(result);
}

function playerContent(flag, id, vipFlags) {
    // El ID puede contener la URL completa del embed
    var url = id;
    
    var result = {
        "parse": 0,
        "url": url,
        "header": {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://cue.cuevana3.nu/"
        }
    };
    
    return JSON.stringify(result);
}

function parseVideo(item) {
    if (!item || !item.info) return null;
    
    var info = item.info;
    var title = item.title || '';
    var link = item.link || '';
    
    // Extraer ID del link
    var vodId = info._id;
    if (link) {
        var matches = link.match(/\/(\d+)\//);
        if (matches && matches[1]) {
            vodId = matches[1];
        }
    }
    
    var video = {
        "vod_id": vodId,
        "vod_name": title,
        "vod_pic": info.cover ? 'https://image.tmdb.org/t/p/w500' + info.cover : '',
        "vod_remarks": info.ratingValue || '',
        "vod_director": info.director ? info.director.map(function(d) { return d[0]; }).join(', ') : '',
        "vod_actor": info.cast ? info.cast.map(function(c) { return c[0]; }).join(', ') : '',
        "vod_content": info.desc || '',
        "vod_year": info.release ? info.release.substring(0, 4) : '',
        "type_id": info.type === 'tv' ? '2' : '1',
        "vod_tag": info.genres ? info.genres.map(function(g) { return g[0]; }).join(', ') : ''
    };
    
    return video;
}

function getProxy(url) {
    return 'proxy://' + btoa(url);
}
