module.exports = {
    queues: {

        GENERATE_VIDEO_THUMBNAIL_QUEUE: 'GENERATE_VIDEO_THUMBNAIL_QUEUE',

        TRANSCRIBE_VIDEO_QUEUE: 'TRANSCRIBE_VIDEO_QUEUE',
        TRANSCRIBE_FINISH_QUEUE: 'TRANSCRIBE_FINISH_QUEUE',

        CONVERT_VIDEO_TO_ARTICLE_QUEUE: 'CONVERT_VIDEO_TO_ARTICLE_QUEUE',
        CONVERT_VIDEO_TO_ARTICLE_FINISH_QUEUE: 'CONVERT_VIDEO_TO_ARTICLE_FINISH_QUEUE',

        EXPORT_ARTICLE_TRANSLATION: `EXPORT_ARTICLE_TRANSLATION`,
        EXPORT_ARTICLE_TRANSLATION_FINISH: `EXPORT_ARTICLE_TRANSLATION_FINISH`,

        ARCHIVE_ARTICLE_TRANSLATION_AUDIOS: `ARCHIVE_ARTICLE_TRANSLATION_AUDIOS`,
        ARCHIVE_ARTICLE_TRANSLATION_AUDIOS_FINISH: `ARCHIVE_ARTICLE_TRANSLATION_AUDIOS_FINISH`,

        BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE: `BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE`,
        BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_FINISH: `BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_FINISH`,    

        BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_AND_SIGNLANGUAGE: `BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_AND_SIGNLANGUAGE`,
        BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_AND_SIGNLANGUAGE_FINISH: `BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_AND_SIGNLANGUAGE_FINISH`,
    
        GENERATE_ARTICLE_TRANSLATION_VIDEO_SUBTITLE: `GENERATE_ARTICLE_TRANSLATION_VIDEO_SUBTITLE`,
        GENERATE_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_FINISH: `GENERATE_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_FINISH`,

        UPDATE_ARTICLE_VIDEO_SPEED: 'UPDATE_ARTICLE_VIDEO_SPEED',
        UPDATE_ARTICLE_VIDEO_SPEED_FINISH: 'UPDATE_ARTICLE_VIDEO_SPEED_FINISH',
    }
}