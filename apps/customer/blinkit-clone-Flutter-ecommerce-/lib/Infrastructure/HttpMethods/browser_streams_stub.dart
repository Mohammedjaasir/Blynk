// Non-web builds: the browser stream primitives do not exist. Android/iOS
// keep their Dio streams; nothing calls these off the web.

Stream<String> fetchTextStream(String url, Map<String, String> headers) =>
    Stream<String>.error(UnsupportedError('fetch streaming is web-only'));

Stream<String> eventSourceTextStream(String url, List<String> events) =>
    Stream<String>.error(UnsupportedError('EventSource is web-only'));
