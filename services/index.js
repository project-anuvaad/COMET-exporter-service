const {
    STORAGE_SERVICE_API_ROOT,
    TEXT_TO_SPEECH_SERVICE_API_ROOT,
} = process.env;



const storageService = require('@videowiki/services/storage')(STORAGE_SERVICE_API_ROOT);
const textToSpeechService = require('@videowiki/services/textToSpeach')(TEXT_TO_SPEECH_SERVICE_API_ROOT);

module.exports = {
    storageService,
    textToSpeechService,
}