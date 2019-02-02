// ==UserScript==
// @name        redditmod3
// @namespace   cc.y4r
// @author      y4r
// @description inline posts/comments, endless scrolling, and other improvements for reddit.com
// @include     http://*.reddit.com/*
// @include     https://*.reddit.com/*
// @version     1.0.0
// @license     WTFPL
// @grant       GM.getValue
// @grant       GM.setValue
// @grant       GM.xmlHttpRequest
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_xmlhttpRequest
// @connect     reddit.com
// @connect     www.reddit.com
// @connect     imgur.com
// @connect     mercury.postlight.com
// @connect     gfycat.com
// @connect     soundcloud.com
// @connect     explosm.net
// @connect     imgflip.com
// @connect     streamable.com
// @connect     instagram.com
// @connect     deviantart.com
// @connect     xkcd.com
// @run-at      document-start
// @require     https://greasemonkey.github.io/gm4-polyfill/gm4-polyfill.js
// ==/UserScript==

/** TODO
 * Support domains: giphy, flickr
 * Can't collapse/expand comments provided by RedditPromise for some reason... need to hijack onclick?
 * Can't click links in inline-comments (should be target=_blank).
 * Clicking bottom of inline-comment (marked as hovered) doesn't expand/collapse.
 * Voting on posts expands/collapses.
 * Can't vote on expanded comments.
 * Setting toggle: Shrink images to screen height
 * "Options" bar @ top: Fit to window, overflow-y:scroll ?
 */

(() => {
  'use strict';

  const DEBUG = true; // TODO: Change to false for release.

  /** Helper/Wrapper around console.log -- includes stack trace. */
  function debug() {
    if (!DEBUG) return;
    const args = ['[Redditmod@'
      + (new Error()).stack.replace(/.*\?id=[a-f0-9\-]*:/g, '').replace(/@.*[^\r\n]/g, '').replace(/\n\n/g, '').replace(/\n$/g, '').replace(/\n/g, ' <- ')
      + ']'];
    for (let i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    console.log.apply(console.log, args);
  }

  /** Helper function for preventing event bubbling. */
  function stopEvent(event) {
    if (event && event.stopPropagation) event.stopPropagation();
    if (event && event.preventDefault) event.preventDefault();
  }


  /**
   * Promises accessors to a loaded configuration.
   */
  const CONFIG = (() => {


    // Existing values are the *default*
    const CSS_COLLAPSABLE_COMMENTS = '.comment.collapsed {padding-bottom: 20px;padding-top: 8px;} .comment.collapsed .tagline, .comment.collapsed .tagline a, .comment.collapsed .search-result-meta, .comment.collapsed .search-result-meta a, .comment.collapsed > span {font-style: normal !important;} .tagline > a.expamd {display: none !important}';

    const config = {
      tweaks: {
        autoAlign: true,
        infiniteScrolling: true,
        loadPostsInline: true,
        collapsableComments: true,
        usernamePrivacy: true,,
        karmaPrivacy: true
      }
    };

    return new Promise(resolve => {
      const keys = Object.keys(config);
      Promise.all(keys.map(key => GM.getValue('redditmod-' + key)))
        .then(values => {
          // Load config
          values.forEach((value, keyIndex) => {
            if (value !== undefined) {
              config[keys[keyIndex]] = JSON.parse(value);
            }
          });

          // Expose public methods
          resolve({
            getTweaks, setTweak, getTweakCSS, isTweakEnabled
          });
        });
    });

    /* optionalKey: if given, only saves that key of the config. */
    function _save(optionalKey) {
      const keys = optionalKey !== undefined ? [optionalKey] : Object.keys(config);
      return new Promise(resolve => {
        Promise.all(keys.map(key => GM.setValue('redditmod-' + key, JSON.stringify(config[key]))))
          .then(resolve);
      });
    }


    // =========================================
    // Tweaks
    function isTweakEnabled(tweakID) { return (config.tweaks[tweakID] === true); }

    function getTweaks() {
      return [
        { name: 'Infinite Scrolling', id: 'infiniteScrolling', enabled: config.tweaks.infiniteScrolling, title: "Load next page when you reach the bottom" },
        { name: 'Load Pages Inline', id: 'loadPostsInline', enabled: config.tweaks.loadPostsInline, title: "Add the next page of posts to the bottom of the current page (ignored when 'Infinite Scrolling' is enabled)." },
        { name: 'Auto-align on expand', id: 'autoAlign', enabled: config.tweaks.autoAlign, title: "Scroll so the clicked post is at the top of the screen." },
        { name: 'Collapsable comments', id: 'collapsableComments', enabled: config.tweaks.collapsableComments, title: "Double click on a comment to collapse its tree" },
        { name: 'Username Privacy', id: 'usernamePrivacy', enabled: config.tweaks.usernamePrivacy, title: "Hide username" },
        { name: 'Karma Privacy', id: 'karmaPrivacy', enabled: config.tweaks.karmaPrivacy, title: "Hide karma" }
      ];
    }

    function getTweakCSS() {
      const results = [];
      if (config.tweaks.collapsableComments) { results.push(CSS_COLLAPSABLE_COMMENTS); }
      // if (config.tweaks.noAds)           { results.push(CSS_NO_ADS); }
      // if (config.tweaks.noChat)          { results.push(CSS_NO_CHAT); }
      // if (config.tweaks.noSublist)       { results.push(CSS_NO_SUBLIST); }
      // if (config.tweaks.noFooter)        { results.push(CSS_NO_FOOTER); }
      // if (config.tweaks.noHeaderImage)   { results.push(CSS_NO_HEADER_IMAGE); }
      // if (config.tweaks.collapseSidebar) { results.push(CSS_COLLAPSE_SIDEBAR); }
      return results.join('');
    }

    function setTweak(tweakID, enabled) {
      const promises = [];
      config.tweaks[tweakID] = enabled;
      promises.push(_save('tweaks'));
      return Promise.all(promises);
    }

  })();

  /**
   * All things CSS & DOM (applying/removing CSS rules, waiting for DOM elements);
   */
  const CSS = (() => {
    const onHead = _onNode('head'); /* Wait for <head> to appear. */
    const onBody = _onNode('body'); /* Wait for <body> to appear. */

    return { onDOM, onHead, applyStyle, removeStyle };

    /** Promises a child node immediately under the root `document`. Waits if node is not found. */
    function _onNode(documentKey) {
      return new Promise(resolve => {
        const timer = setInterval(promiseNode, 50);
        function promiseNode() {
          if (document[documentKey]) {
            clearInterval(timer);
            resolve(document[documentKey]);
          }
        }
      });
    }

    /** Promises /when/ the DOM is loaded & ready. */
    function onDOM() {
      return new Promise(resolve => {
        if (document.readyState === 'interactive' || document.readyState === 'complete') {
          resolve();
        } else {
          document.addEventListener('DOMContentLoaded', function(event) {
            document.removeEventListener('DOMContentLoaded', event.callee);
            resolve();
          });
        }
      });
    }

    /**
     * Waits for <head> to appear, then applies CSS rules to the page.
     * Removes existing CSS Rules that match the given ID.
     * @param {String} id The identifier for this style.
     * @param {String} css The CSS rules in text/string format.
     * @return Promise for when style is applied.
     */
    function applyStyle(id, css) {
      return new Promise(resolve => {
        onHead.then(head => {
          let style = head.querySelector('.redditmod-style#' + id);
          if (style !== null && style.firstChild) {
            style.removeChild(style.firstChild);
          } else {
            style = document.createElement('style');
            Object.assign(style, { id: id, type: 'text/css', className: 'redditmod-style' });
          }
          style.appendChild(document.createTextNode(css));
          head.appendChild(style);
          resolve(head);
        });
      });
    }

    /** @param {String} id The style ID, set when `applyStyle` is called. */
    function removeStyle(id) {
      const style = document.head.querySelector('style#' + id);
      if (style) style.parentNode.removeChild(style);
    }
  })();


  /** */
  const MENU = (() => {
    const MENU_STYLE_ID = 'redditmod-menu-style';
    const MENU_STYLE = '.redditmod-menu-header{margin:3px 5px 3px 5px}';

    let isInitialized = false;
    let config;
    return { init };

    function init(theConfig) {
      config = theConfig;
      return new Promise(resolve => {
        if (isInitialized) {
          resolve({ updateMenuSection });
        } else {
          CSS.onDOM().then(() => {
            resetMenu();
            CSS.applyStyle(MENU_STYLE_ID, MENU_STYLE);
            isInitialized = true;
            resolve({ updateMenuSection });
          });
        }
      });
    }

    function resetMenu() {
      const menu = document.querySelector('.dropdown.srdrop .selected');
      if (menu) menu.textContent = 'OPTIONS';
      const dropdown = document.querySelector('.drop-choices.srdrop');
      if (dropdown) dropdown.innerHTML = '';
    }

    function create(tag, props, parentToAppendTo) {
      const node = document.createElement(tag);
      if (props) Object.assign(node, props);
      if (parentToAppendTo) parentToAppendTo.appendChild(node);
      return node;
    }

    function updateMenuSection(title, id, anchorsProps) {
      const dropdown = document.querySelector('.drop-choices.srdrop');
      if (!dropdown) return;

      if (document.querySelector('.drop-choices.srdrop .redditmod-menu-header') !== null && document.querySelector('#' + id) === null) {
        create('hr', { className: 'redditmod-menu-spacer' }, dropdown);
      }

      const section = document.querySelector('#' + id) || create('div', { id }, dropdown);
      const header = section.querySelector('.redditmod-menu-header') || create('h3', { className: 'redditmod-menu-header' }, section);
      const links = section.querySelector('.redditmod-menu-links') || create('div', { className: 'redditmod-menu-links' }, section);

      header.textContent = title;
      links.innerHTML = '';
      anchorsProps.forEach(props => {
        if (!props.href) props.href = '#';
        create('a', props, links).className = 'choice';
      });
    }
  })();

  const MEDIA = (() => {
    const CLASS_MEDIA_EXPANDED = 'redditmod-media-expanded',
      CLASS_COMMENTS_EXPANDED = 'redditmod-comments-expanded',
      CLASS_MEDIABOX = 'redditmod-media-box',
      CLASS_COMMENTS = 'redditmod-comments-box',
      CLASS_MEDIA = 'redditmod-media',
      CLASS_SPINNER = 'redditmod-media-spinner',
      CLASS_ERROR = 'redditmod-media-error',
      MEDIA_STYLE_ID = 'redditmod-media-style',
      MEDIA_STYLE_CSS = '.redditmod-media-box, .redditmod-comments-box{max-height:0; height:0; overflow:hidden; transition: height linear 0.2s, max-height linear 0.2s}' +
        '.redditmod-media{}' + // ???
        '.redditmod-media-expanded .redditmod-media-box, .redditmod-comments-expanded .redditmod-comments-box{max-height:10000px; height:auto}' +
        '.redditmod-media-spinner,.redditmod-media-spinner:after{border-radius:50%;width:10em;height:10em}.redditmod-media-spinner{margin:60px auto;font-size:10px;position:relative;text-indent:-9999em;border-top:1.1em solid rgba(255,255,255,.2);border-right:1.1em solid rgba(255,255,255,.2);border-bottom:1.1em solid rgba(255,255,255,.2);border-left:1.1em solid #fff;-webkit-transform:translateZ(0);-ms-transform:translateZ(0);transform:translateZ(0);-webkit-animation:load8 1.1s infinite linear;animation:load8 1.1s infinite linear}@-webkit-keyframes load8{0%{-webkit-transform:rotate(0);transform:rotate(0)}100%{-webkit-transform:rotate(360deg);transform:rotate(360deg)}}@keyframes load8{0%{-webkit-transform:rotate(0);transform:rotate(0)}100%{-webkit-transform:rotate(360deg);transform:rotate(360deg)}}' +
        '.redditmod-media-error{background-color:rgba(255,0,0,0.3); color:#fff; text-shadow:1px 1px #000}';

    CSS.applyStyle(MEDIA_STYLE_ID, MEDIA_STYLE_CSS);

    return { postClick };

    function postClick(thing, event) {
      const target = event.target;
      const thingAnchor = thing.querySelector('a.title');
      const thingHref = thing.getAttribute('data-url');
      const thingUrl = thingHref || thingAnchor && thingAnchor.href;

      if (target.tagName === 'A' && target.classList.contains('comments')) {
        stopEvent(event);
        _fetchCommentsbox(thing, target.href)._toggle();
        return false;

      } else if (_shouldUseExpando(thing, thingUrl)) {
        if (!target.classList.contains('expando-button')) {
          const expandoButton = thing.querySelector('.expando-button');
          if (expandoButton) {
            expandoButton.click(event);
          }
        }
        return true;

      } else if ((target.tagName === 'A') ||
        (target.tagName === 'VIDEO' && target.controls === 'true') ||
        (target.classList.contains('expando-button'))) {
        return true; // Pass-through

      } else {
        _fetchMediabox(thing, thingUrl).click(event); // Fetch/Contruct mediabox & click it.
        return false;
      }
    }

    function _shouldUseExpando(thing, thingUrl) {
      if (!thing.querySelector('.expando-button')) {
        return false;
      } else if (thing.classList.contains('self')) {
        return true;
      } else if (/https?:\/\/(\w+\.)*(v\.redd\.it|clips\.twitch\.tv|reddituploads\.com|vimeo\.com|youtube\.com|youtu\.be)\/.*$/.test(thingUrl)) {
        return true;
      } else {
        return false;
      }
    }

    function _fetchCommentsbox(thing, thingUrl) {
      const existing = thing.querySelector('.' + CLASS_COMMENTS);
      if (existing) {
        return existing;
      }

      const commentsBox = _create('div', { className: CLASS_COMMENTS }, thing);
      commentsBox.onclick = stopEvent;
      commentsBox._toggle = () => {
        thing.classList.remove(CLASS_MEDIA_EXPANDED);
        thing.classList.toggle(CLASS_COMMENTS_EXPANDED);
      };

      const spinner = _create('div', { className: CLASS_SPINNER }, commentsBox);
      RedditCommentsPromise(thingUrl)
        .then(container => {
          commentsBox.removeChild(spinner);
          commentsBox.appendChild(container);
        }).catch(reason => {
          debug('RedditCommentsPromise rejected, reason:', reason);
        });

      return commentsBox;
    }

    function _fetchMediabox(thing, thingUrl) {
      // Use existing mediabox
      const existingMediabox = thing.querySelector('.' + CLASS_MEDIABOX);
      if (existingMediabox) return existingMediabox;

      // Create a custom mediabox
      const mediaBox = _create('div', { className: CLASS_MEDIABOX }, thing);
      mediaBox.onclick = event => {
        stopEvent(event);
        thing.classList.remove(CLASS_COMMENTS_EXPANDED);
        thing.classList.toggle(CLASS_MEDIA_EXPANDED);
        const media = thing.querySelector('.' + CLASS_MEDIA);
        if (thing.classList.contains(CLASS_MEDIA_EXPANDED)) {
          if (media && media._onshow) media._onshow();
        } else {
          if (media && media._onhide) media._onhide();
        }
        CONFIG.then(config => {
          if (config.isTweakEnabled('autoAlign')) {
            thing.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'smooth' });
          }
        })
      };

      const spinner = _create('div', { className: CLASS_SPINNER }, mediaBox);

      mediaBoxPromise(thingUrl)
        .then(media => {
          media.classList.add(CLASS_MEDIA);
          mediaBox.removeChild(spinner);
          mediaBox.appendChild(media);
        }).catch(reason => {
          debug('mediaboxPromise rejected, reason:', reason);
          mediaBox.removeChild(spinner);
          const errorBox = _create('div', { className: CLASS_ERROR }, mediaBox);
          errorBox.textContent = reason;
        });
      return mediaBox;
    }

    function mediaBoxPromise(urlText) {
      return new Promise((resolve, reject) => {
        const url = new URL(urlText);
        const domain = url.hostname.replace(/^(?:.*\.)?(\w+\.\w+)$/, '$1');
        let promise;
        switch (domain) {
          case 'imgur.com': promise = ImgurMediaPromise(url); break;
          case 'gfycat.com': promise = GfycatMediaPromise(url); break;
          //           case 'soundcloud.com': promise = SoundcloudPromise(url);   break;
          //           case 'explosm.net':    promise = ExplosmPromise(url);      break;
          case 'imgflip.com': promise = ImgflipPromise(url); break;
          case 'streamable.com': promise = StreamablePromise(url); break;
          case 'instagram.com': promise = InstagramPromise(url); break;
          case 'deviantart.com': promise = DeviantartPromise(url); break;
          //           case 'xkcd.com':       promise = XkcdPromise(url);         break;
          case 'reddit.com': promise = RedditPromise(url); break;
          default: promise = GenericMediaPromise(url); break;
        }
        promise.then(resolve).catch(reject);
      });
    }

    function _create(tag, props, parentNode) {
      const node = document.createElement(tag);
      if (props) {
        Object.assign(node, props);
      }
      if (parentNode) {
        parentNode.appendChild(node);
      }
      return node;
    }

    function _getJSON(url, headers, use_GM_XHR) {
      return new Promise((resolve, reject) => {
        if (!headers) {
          headers = { 'Accept': 'application/json' };
        } else if (!headers.Accept) {
          headers.Accept = 'application/json';
        }
        _getWEB(url, headers, use_GM_XHR)
          .then(responseText => {
            try {
              resolve(JSON.parse(responseText));
            } catch (err) {
              debug('_getJSON error. url:', url.toString(), 'responseText', responseText);
              reject('[MEDIA._getJSON] Error parsing JSON text from ' + url.toString() + ' : ' + responseText);
            }
          })
          .catch(reason => {
            reject('[Media._getJSON] Error fetching JSON from url ' + url.toString() + ' reason: ' + reason);
          });
      });
    }

    function _getWEB(url, headers, use_GM_XHR) {
      return new Promise(function(resolve, reject) {
        if (!headers) {
          headers = {};
        }
        if (use_GM_XHR) {
          debug('MEDIA._getWEB() via GM.xmlHttpRequest(), fetching url:', url, 'with headers', headers);
          GM.xmlHttpRequest({
            method: 'GET',
            url: url,
            headers: headers,
            onabort: onError,
            onerror: onError,
            onload: function(response) {
              debug('MEDIA._getWEB() got GM.xmlHttpRequest response (' + response.responseText.length.toLocaleString() + ' bytes)');
              resolve(response.responseText);
            }
          });
        } else {
          debug('MEDIA._getWEB() via XMLHttpRequest(), fetching url:', url, 'with headers', headers);
          const xhr = new XMLHttpRequest();
          xhr.onload = function(response) {
            debug('MEDIA._getWEB() got response (' + response.target.responseText.length.toLocaleString() + ' bytes)');
            resolve(response.target.responseText);
          };
          xhr.onerror = onError;
          xhr.onabort = onError;
          xhr.open('GET', url, true);
          Object.keys(headers).forEach(key => {
            xhr.setRequestHeader(key, headers[key]);
          });
          xhr.send(null);
        }

        function onError(reason) {
          debug('MEDIA._getWEB error. url:', url.toString(), 'reason:', reason);
          reject('[MEDIA._getWEB] Error fetching data from ' + url + ' Reason: ' + reason.error);
        }
      });
    }

    function _getDocument(url, headers, use_GM_XHR) {
      return new Promise((resolve, reject) => {
        _getWEB(url, headers, use_GM_XHR)
          .then(responseText => {
            const html = document.createElement('html');
            html.innerHTML = responseText;
            resolve(html);
          })
          .catch(reject);
      });
    }

    function GenericMediaPromise(url) {
      return new Promise((resolve, reject) => {
        const urlText = url.toString();
        if (/\.(jpe?g|gif|png|mp4)(\?.*)?$/i.test(urlText)) {
          GenericImagePromise([urlText]).then(resolve).catch(reject);
        } else {
          PostlightMediaPromise(urlText).then(resolve).catch(reject);
        }
      });
    }

    function PostlightMediaPromise(url) {
      return new Promise((resolve, reject) => {
        const postlightUrl = 'https://mercury.postlight.com/parser?url=' + encodeURIComponent(url);
        const headers = { 'X-api-key': 'NtFdFjTYzQXF4WUWBivfsnTj0zXZyvwCKbSQeuAB' };
        _getJSON(postlightUrl, headers, true)
          .then(resp => {
            if (resp.content === '<body></body>') {
              reject('[PostlightMediaProimse] Postlight returned empty content for ' + url);
            } else {
              resolve(_create('div', { innerHTML: resp.content, className: 'redditmod-media-other' }));
            }
          })
          .catch(reject);
      });
    }

    function GenericImagePromise(urls) {
      return new Promise((resolve, reject) => {
        if (urls.length === 0) {
          debug('GenericImagePromise error. No URLs given:', urls);
          reject('[GenericImagePromise] No URLs given');
          return;
        }
        let index = 0;
        const container = _create('div');
        const nav = _create('div', {}, container);
        const navPrev = _create('a', { textContent: '<', href: '#' }, nav);
        const navCurrent = _create('span', { textContent: '1' }, nav);
        const navSep = _create('span', { textContent: '/' }, nav);
        const navTotal = _create('span', { textContent: urls.length }, nav);
        const navNext = _create('a', { textContent: '>', href: '#' }, nav);
        const imageDiv = _create('div', {}, container);
        const image = _create('img', {
          src: urls[0],
          style: 'max-width:100%; max-height:100%; object-fit:scale-down'
        }, imageDiv);
        if (urls.length === 1) {
          nav.style.display = 'none';
        } else {
          container._click = navNext.click;
        }
        navPrev.onclick = event => {
          stopEvent(event);
          if (--index < 0) index = urls.length - 1;
          navCurrent.textContent = (index + 1).toString().padStart(urls.length.toString().length, '0');
          image.removeAttribute('src');
          image.src = urls[index];
          return false;
        };
        navNext.onclick = event => {
          stopEvent(event);
          if (++index === urls.length) index = 0;
          navCurrent.textContent = (index + 1).toString().padStart(urls.length.toString().length, ' ');
          image.removeAttribute('src');
          setTimeout(() => {
            image.src = urls[index];
          }, 10);
          return false;
        };
        resolve(container);
      });
    }

    function GenericVideoPromise(urls) {
      return new Promise(resolve => {
        const video = _create('video', {
          controls: false,
          autoplay: true,
          loop: true,
          style: 'display:block; width:' + (window.innerWidth - 75) + 'px; height:' + (window.innerHeight - 75) + 'px',
        });
        video._onhide = video.pause;
        video._onshow = video.load;
        urls.forEach(url => _create('source', { src: url }, video));
        resolve(video);
      });
    }

    function ImgurMediaPromise(url) {
      return new Promise((resolve, reject) => {
        let urlText = url.toString();
        const albumIdMatches = urlText.match(/imgur\.com\/(?:gallery|a|r\/[^\/]+)\/(\w+)/i);
        debug('ImgurMediaPromise: url: ' + url + ', albumIdMatches:', albumIdMatches);
        if (albumIdMatches) {
          // Album: Extract images
          _getJSON('https://imgur.com/ajaxalbums/getimages/' + albumIdMatches[1] + '/hit.json', {}, true)
            .then(resp => {
              if (!resp.data.images) {
                debug('ImgurMediaPromise: No resp.data.images, assuming single image:', albumIdMatches[1] + '.jpg');
                GenericImagePromise(['https://i.imgur.com/' + albumIdMatches[1] + '.jpg']).then(resolve).catch(reject);
              } else {
                debug('ImgurMediaPromise: Got ' + resp.data.images.length + ' images from album');
                GenericImagePromise(resp.data.images.map(image => 'https://i.imgur.com/' + image.hash + image.ext)).then(resolve).catch(reject);
              }
            });
        } else if (/\.(gifv?|mp4)$/.test(url)) {
          // Video
          debug('ImgurMediaPromise: gifv/mp4');
          urlText = urlText.replace(/\.gifv?$/, '.mp4');
          GenericVideoPromise([urlText]).then(resolve).catch(reject);
        } else {
          // Image?
          urlText = urlText.replace(/[^/]*\.imgur\.com/, 'i.imgur.com');
          urlText = urlText.replace(/\/\w+\//, '');
          urlText = urlText.replace(/_[a-z]\./, '.');
          urlText = urlText.replace(/\.(gif|jpg|jpeg|png)$/i, '');
          urlText = urlText + '.jpg';
          debug('ImgurMediaPromise: Unknown type, generated/mangled URL:', urlText);
          GenericImagePromise([urlText]).then(resolve).catch(reject);
        }
      });
    }

    function GfycatMediaPromise(url) {
      return new Promise((resolve, reject) => {
        let gfycatUrl = url.href;
        const shortCode = url.href.match(/gfycat\.com\/(?:.*\/)?([a-z0-9]*)/i);
        if (shortCode) {
          gfycatUrl = 'https://gfycat.com/' + shortCode[1];
        }
        _getDocument(gfycatUrl, {}, true)
          .then(doc => {
            let video = doc.querySelector('#mp4Source');
            if (!video) {
              video = doc.querySelector('.video.media source[type="video/mp4"]');
            }
            if (!video || !video.src) {
              reject('[GfycatMediaPromise] Could not find video at ' + gfycatUrl + ' body: ' + doc.innerHTML);
            } else {
              GenericVideoPromise([video.src]).then(resolve);
            }
          })
          .catch(reject);
      });
    }

    function RedditPromise(url) {
      const urlText = url.toString();
      return new Promise((resolve, reject) => {
        if (/reddit\.com.*\/comments\/.*/.test(urlText)) {
          RedditCommentsPromise(urlText).then(resolve).catch(reject);
        } else {
          debug('RedditPromise error. Unable to load non-comments Reddit page', urlText);
          reject('[RedditPromise] Unable to load non-comments Reddit page ' + urlText);
        }
      });
    }

    function RedditCommentsPromise(url) {
      return new Promise((resolve, reject) => {
        _getDocument(url, {}, false)
          .then(doc => {
            const commentArea = doc.querySelector('.commentarea .sitetable > *:not(.clearleft)');
            const container = _create('div', { className: 'redditmod-media-comments-area' });
            commentArea.querySelectorAll('.thing').forEach(thing => {
              thing.ondblclick = event => {
                if (config.isTweakEnabled('collapsableComments')) {
                  // Expand/collapse comment tree
                  stopEvent(event);
                  $(thing).toggleClass("collapsed noncollapsed");
                  return false;
                } else {
                  return true; // Pass-through
                }
              };
            });
            container.appendChild(commentArea);
            container._click = () => { };
            resolve(container);
          })
          .catch(reject);
      });
    }

    function SoundcloudPromise(url) {
      return new Promise((resolve, reject) => {
        _getWEB(url.toString(), {}, true)
          .then(responseText => {
            let matches = responseText.match(/meta itemprop="embedUrl" content="([^"]*)"/);
            if (!matches) {
              matches = responseText.match(/meta property="twitter:player" content="([^"]*)"/);
            }
            if (matches && matches.length > 0) {
              const iframe = _create('iframe', {
                style: 'width:100%; height:' + (window.innerHeight / 2) + 'px',
                src: matches[1]
              });
              resolve(iframe);
            } else {
              reject('[SoundcloudPromise] No soundcloud data found at ' + url.toString());
            }
          })
          .catch(reject);
      });
    }

    function ExplosmPromise(url) {
      return new Promise(function(resolve, reject) {
        _getDocument(url.toString(), {}, true)
          .then(doc => {
            const imageMeta = doc.querySelector('img#main-comic');
            if (imageMeta) {
              GenericImagePromise([imageMeta.src]).then(resolve, reject);
            } else {
              reject('[ExplosmPromise] No images found at ' + url.toString());
            }
          })
          .catch(reject);
      });
    }

    function ImgflipPromise(url) {
      return new Promise(function(resolve, reject) {
        const urlText = url.toString();
        if (/\.(jpg|jpeg|png)$/i.test(urlText)) {
          GenericImagePromise([urlText]).then(resolve).catch(reject);
        }
        _getDocument(urlText, {}, true)
          .then(doc => {
            const imageMeta = doc.querySelector('img#im');
            if (imageMeta) {
              GenericImagePromise([imageMeta.src]).then(resolve, reject);
            } else {
              reject('[ImgflipPromise] No images found at ' + urlText);
            }
          })
          .catch(reject);
      });
    }

    function StreamablePromise(url) {
      return new Promise((resolve, reject) => {
        const matches = url.href.match(/streamable\.com\/([a-zA-Z0-9]*)/);
        if (!matches) reject('[StreamablePromise] No Streamable ID found in url ' + url.toString());
        const apiUrl = 'https://api.streamable.com/videos/' + matches[1];
        _getJSON(apiUrl, {}, true)
          .then(json => {
            GenericVideoPromise([json.files.mp4.url]).then(resolve, reject);
          }).catch(reject);
      });
    }

    function InstagramPromise(url) {
      const urlText = url.toString();
      const matches = urlText.match(/instagram\.com\/p\/([a-zA-Z0-9_\-]*)/);
      const apiUrl = 'https://instagram.com/p/' + matches[1] + '/';
      return new Promise((resolve, reject) => {
        if (!matches) {
          reject('[InstagramPromise] InstagramPromise error. No images found at', urlText);
          return;
        }
        _getDocument(apiUrl, {}, true).then(doc => {
          const videoMeta = doc.querySelector('meta[property="og:video"]');
          const imageMeta = doc.querySelector('meta[property="og:image"]');
          if (videoMeta) {
            GenericVideoPromise([videoMeta.content]).then(resolve, reject);
          } else if (imageMeta) {
            GenericImagePromise([imageMeta.content]).then(resolve, reject);
          } else {
            reject('[InstagramPromise] Error: No images found at ' + apiUrl);
          }
        }).catch(reject);
      });
    }

    function DeviantartPromise(url) {
      return new Promise(function(resolve, reject) {
        _getDocument(url.toString(), {}, true).then(doc => {
          const fullImg = doc.querySelector('img[dev-content-full]');
          const smallImg = doc.querySelector('meta[property="og:image"]');
          if (fullImg) {
            GenericImagePromise([fullImg.src]).then(resolve, reject);
          } else if (smallImg) {
            GenericImagePromise([smallImg.content]).then(resolve, reject);
          } else {
            reject('[DeviantartPromise] Error: No images found at ' + url.toString());
          }
        }).catch(reject);
      });
    }

    function XkcdPromise(url) {
      return new Promise((resolve, reject) => {
        const matches = url.href.match(/xkcd\.com\/([0-9]+)/);
        if (matches) {
          _getJSON("https://xkcd.com/" + matches[1] + "/info.0.json", {}, true).then(json => {
            const xkcdDiv = document.createElement("div");
            const h3 = document.createElement("h3");
            const img = document.createElement("img");
            const h5 = document.createElement("h5");
            h3.textContent = json.title;
            img.src = json.img;
            img.title = json.alt;
            h5.textContent = json.alt;
            xkcdDiv.appendChild(h3);
            xkcdDiv.appendChild(img);
            xkcdDiv.appendChild(h5);
            resolve(xkcdDiv);
          }).catch(reject)
        } else if (/\.(png|gif|jpe?g)$/i.test(url.href)) {
          GenericImagePromise([url.toString()]).then(resolve).catch(reject);
        } else {
          reject('Failed to find XKCD metadata from ' + url.toString());
        }
      });
    }
  })();

  function Processors(config, menuPromise) {
    const processors = {};

    return new Promise(resolve => {
      menuPromise.then(menu => {
        processPosts();
        processComments();
        resolve({ processors, processPost, processPosts, processComment, processComments });
      });
    });

    function processPosts() {
      document.querySelectorAll('#siteTable .thing').forEach(thing => processPost(thing));
    }

    function processPost(thing) {
      // Hide/Show media when post is dblclicked
      thing.addEventListener('dblclick', event => MEDIA.postClick(thing, event));

      // Remove tracking from links if user did not specify in preferences.
      thing.querySelectorAll('a[data-outbound-url], a[data-outbound-expiration], a[data-inbound-url]')
        .forEach(anchor => {
          if (anchor.dataset) {
            if (anchor.dataset.outboundUrl) delete anchor.dataset.outboundUrl;
            if (anchor.dataset.outboundExpiration) delete anchor.dataset.outboundExpiration;
            if (anchor.dataset.inboundUrl) delete anchor.dataset.inboundUrl;
          }
        });
    }

    function processComments() {
      document.querySelectorAll('.commentarea .sitetable > *:not(.clearleft)').forEach(thing => processComment(thing));
    }

    function processComment(thing) {
      // Expand/collapse comment tree
      thing.ondblclick = event => {
        if (config.isTweakEnabled('collapsableComments')) {
          stopEvent(event);
          $(thing).toggleClass("collapsed noncollapsed");
          return false;
        } else {
          return true; // Pass-through
        }
      };
    };

  }

  function Navigation(processor) {
    let loading = false;

    CSS.onDOM().then(() => {
      overrideNextButton();
      scrollListener();
      addScrollListener();
    });

    return { scrollListener, addScrollListener };

    function scrollListener(event) {
      const evt = event || { pageY: 0 };
      if (document.body.clientHeight - (window.scrollY + window.innerHeight) < 200) {
        CONFIG.then(config => {
          if (config.isTweakEnabled('infiniteScrolling')) {
            loadMorePosts();
          }
        });
      }
    }

    function addScrollListener() { window.addEventListener('scroll', scrollListener); }
    function removeScrollListener() { window.removeEventListener('scroll', scrollListener); }

    function loadMorePosts() {
      const nextButton = document.querySelector('.next-button a');
      if (loading || !nextButton) {
        return;
      }

      loading = true;
      removeScrollListener();

      debug('[Navigation.loadMorePosts] Fetching URL (via nextButton.href):', nextButton.href);
      const xhr = new XMLHttpRequest();
      xhr.onload = function(response) {
        _injectPosts(response.target);
      };
      xhr.onerror = _onError;
      xhr.onabort = _onError;
      xhr.open('GET', nextButton.href, true);
      xhr.send(null);
      /*GM.xmlHttpRequest({
        method: "GET",
        url: nextButton.href,
        onabort: _onError,
        onerror: _onError,
        onload: _injectPosts
      });*/

      const parentNode = nextButton.parentNode.parentNode;
      parentNode.style.backgroundColor = '#aaa';
      parentNode.opacity = '0.5';
      parentNode.cursor = 'not-allowed';
      parentNode.childNodes.forEach(child => {
        if (child.style) {
          child.style.display = 'none';
        }
      });

      function _onError(response) {
        debug('Navigation.loadMorePosts() error. url:', nextButton.href, 'response:', response);
        const errDiv = document.createElement('div');
        errDiv.className = 'redditmod-media-error';
        errDiv.textContent = 'Navigation.loadMorePosts() error. URL: ' + nextButton.href + ' Reason: ' + (response.error || response.responseText);
        nextButton.parentNode.parentNode.appendChild(errDiv);
      }
    }

    function _injectPosts(response) {
      debug('[Navigation.loadMorePosts._injectPosts] Got response (' + response.responseText.length.toLocaleString() + ' bytes)');
      const previousNav = document.querySelector('.nav-buttons');
      const html = document.createElement('html');
      html.innerHTML = response.responseText;
      html.querySelectorAll('#siteTable > *').forEach(thing => {
        if (thing.classList.contains('clearleft')) return;
        if (!thing.id) {
          previousNav.parentNode.insertBefore(thing, previousNav);
        } else if (!document.querySelector('#' + thing.id)) {
          /* !!!!!!! */
          processor.processPost(thing);
          /* !!!!!! */
          previousNav.parentNode.insertBefore(thing, previousNav);
        } else {
          debug('[Navigation.loadMorePosts._injectPosts] Ignoring duplicate post. thing.id:', thing.id);
        }
      });
      previousNav.parentNode.removeChild(previousNav);

      // Re-enable features on the "new page".
      overrideNextButton();
      addScrollListener();
      loading = false;
      setTimeout(scrollListener, 250);
    }

    function overrideNextButton() {
      const nextButton = document.querySelector('.next-button a');
      if (!nextButton) return;
      nextButton.addEventListener('click', event => {
        CONFIG.then(config => {
          if (config.isTweakEnabled('loadPostsInline')) {
            stopEvent(event);
            loadMorePosts();
          }
        });
      });
    }
  }

  function Tweaks(config, menuPromise) {
    const TWEAK_STYLE_ID = 'redditmod-tweak-style';

    return new Promise(resolve => {
      // Apply tweaks CSS before MENU loads
      _applyTweakCSS();

      menuPromise.then(menu => {
        updateMenu(menu);
        resolve({
          updateMenu: () => updateMenu(menu)
        });
      });
    });

    function _applyTweakCSS() {
      CSS.applyStyle(TWEAK_STYLE_ID, config.getTweakCSS());
    }

    function _applyTweakJS() {
      const username = document.querySelector('span.user > a');
      if (username && config.isTweakEnabled('usernamePrivacy')) {
        username.innerHTML = 'Hidden';
      }

      const karma = document.querySelector('span.userkarma');
      if (karma && config.isTweakEnabled('karmaPrivacy')) {
        karma.innerHTML = '~';
      }
    }

    function _tweakLinkProps(tweak, menu) {
      return {
        innerHTML: (tweak.enabled ? '&#9745; ' : '&#9744; ') + tweak.name,
        title: tweak.title,
        onclick: event => {
          stopEvent(event);
          config.setTweak(tweak.id, !config.isTweakEnabled(tweak.id))
            .then(() => {
              _applyTweakCSS();
              updateMenu(menu);
            });
        }
      };
    }

    function updateMenu(menu) {
      if (!menu) return;
      menu.updateMenuSection(
        'tweaks', 'redditmod-menu-tweaks',
        config.getTweaks().map(tweak => _tweakLinkProps(tweak, menu))
      );
    }
  }

  debug('Startup: config');
  CONFIG.then(config => {
    debug('Startup: menuPromise (config:', config, ')');
    const menuPromise = MENU.init(config);

    debug('Startup: tweak, & processors (menuPromise:', menuPromise, ')');
    Promise.all([
      Tweaks(config, menuPromise),
      Processors(config, menuPromise)
    ]).then(([tweaks, processors]) => {
      debug('Startup: navigation');
      const navigation = Navigation(processors);
      debug('Startup: COMPLETE (navigation:', navigation, ')');
    });

  });
})();
