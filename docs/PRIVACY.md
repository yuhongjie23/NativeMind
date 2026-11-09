# NativeMind privacy information

Updated: 2026-11-09. Applies to NativeMind 2.0.0 and the NativeMind Local Anna edition.

Tasks, notes, imported documents, conversations, learning progress, reviews and settings are stored on your computer. NativeMind does not provide a cloud synchronization service. Backups and exports are saved to the location you choose. A folder you place inside a third-party sync service is subject to that service's own behavior.

Local AI features send requests to Ollama on your computer. Models are installed separately. The regular GitHub desktop edition also offers optional DeepSeek and external search: enabling and using them sends the relevant request/context or search keywords to the selected external service. API keys are stored in local settings; protect your local data and backups accordingly.

The **NativeMind Local edition distributed through Anna disables remote AI and external search**. Its Anna page sends only an empty-argument request to open the local app; the tool returns a fixed launch status. Learning content, local paths, model responses and database access are not exposed through this launch tool. The local user confirms opening the app. Anna processes account, installation and launch metadata under Anna's own policies.

The Anna Local edition uses a separate application data directory from the regular desktop edition. Isolation is based on the Windows user and local application directory; switching Anna accounts under the same Windows user does not create separate learning databases. Software already authorized to read files under that Windows account remains subject to its own permissions.

You can export or restore your learning data using Settings. Uninstalling software does not necessarily erase your learning database or exported backups. Review your chosen data and backup locations before deleting anything. System reminders may display the reminder text through Windows notifications when you enable that feature.

Questions and issue reports: [NativeMind issues](https://github.com/yuhongjie23/NativeMind/issues). Do not include private notes, credentials or complete personal database backups in public reports.
