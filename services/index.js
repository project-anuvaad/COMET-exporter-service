const {
    ARTICLE_SERVICE_API_ROOT,
    TRANSLATION_EXPORT_SERVICE_API_ROOT,
    USER_SERVICE_API_ROOT,
    VIDEO_SERVICE_API_ROOT,
    NOTIFICATION_SERVICE_API_ROOT,
    WEBSOCKETS_SERVICE_API_ROOT,
    STORAGE_SERVICE_API_ROOT,
    SUBTITLES_SERVICE_API_ROOT,
    TEXT_TO_SPEECH_SERVICE_API_ROOT,
} = process.env;


const articleService = require('@videowiki/services/article')(ARTICLE_SERVICE_API_ROOT);
const userService = require('@videowiki/services/user')(USER_SERVICE_API_ROOT);
const notificationService = require('@videowiki/services/notification')({ API_ROOT: NOTIFICATION_SERVICE_API_ROOT, WEBSOCKETS_API_ROOT: WEBSOCKETS_SERVICE_API_ROOT });
const videoService = require('@videowiki/services/video')(VIDEO_SERVICE_API_ROOT);
const translationExportService = require('@videowiki/services/translationExport')(TRANSLATION_EXPORT_SERVICE_API_ROOT)
const subtitlesService = require('@videowiki/services/subtitles')(SUBTITLES_SERVICE_API_ROOT)

const storageService = require('@videowiki/services/storage')(STORAGE_SERVICE_API_ROOT);
const textToSpeechService = require('@videowiki/services/textToSpeach')(TEXT_TO_SPEECH_SERVICE_API_ROOT);

module.exports = {
    articleService,
    userService,
    notificationService,
    videoService,
    translationExportService,
    subtitlesService,
    storageService,
    textToSpeechService,
}