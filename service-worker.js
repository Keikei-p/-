const CACHE_NAME = "sales-management-pwa-v2";

const STATIC_ASSETS = [
  "./manifest.webmanifest",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener(
  "install",
  event => {
    event.waitUntil(
      caches
        .open(CACHE_NAME)
        .then(cache =>
          cache.addAll(
            STATIC_ASSETS
          )
        )
        .then(() =>
          self.skipWaiting()
        )
    );
  }
);

self.addEventListener(
  "activate",
  event => {
    event.waitUntil(
      caches
        .keys()
        .then(keys =>
          Promise.all(
            keys
              .filter(
                key =>
                  key !==
                  CACHE_NAME
              )
              .map(
                key =>
                  caches.delete(
                    key
                  )
              )
          )
        )
        .then(() =>
          self.clients.claim()
        )
    );
  }
);

self.addEventListener(
  "fetch",
  event => {
    const request =
      event.request;

    if (
      request.method !==
      "GET"
    ) {
      return;
    }

    const url =
      new URL(
        request.url
      );

    if (
      url.origin !==
      self.location.origin
    ) {
      return;
    }

    /*
      HTML / 画面遷移は必ずネットワークから取得する。
      古い index.html を PWA が保持し続けるのを防ぐ。
    */
    if (
      request.mode ===
        "navigate" ||
      url.pathname.endsWith(
        "/index.html"
      ) ||
      url.pathname.endsWith(
        "/-/"
      )
    ) {

      event.respondWith(
        fetch(
          request,
          {
            cache:
              "no-store"
          }
        )
      );

      return;
    }

    /*
      manifest とアイコンだけはキャッシュ利用可。
      アプリ本体はオンライン前提。
    */
    if (
      STATIC_ASSETS.some(
        asset =>
          url.pathname.endsWith(
            asset.replace(
              "./",
              "/"
            )
          )
      )
    ) {

      event.respondWith(
        caches.match(
          request
        ).then(
          cached =>
            cached ||
            fetch(
              request
            ).then(
              response => {
                const copy =
                  response.clone();

                caches
                  .open(
                    CACHE_NAME
                  )
                  .then(
                    cache =>
                      cache.put(
                        request,
                        copy
                      )
                  );

                return response;
              }
            )
        )
      );
    }
  }
);
