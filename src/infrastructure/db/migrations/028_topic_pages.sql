CREATE UNIQUE INDEX idx_topic_page_selection ON notes (json_extract(metadata, '$.topicPage.selectionKey'))
