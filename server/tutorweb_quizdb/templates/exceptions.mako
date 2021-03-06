<!DOCTYPE html>
<html lang="en">
<head>
  <title>Tutorweb: Log in</title>
  <meta http-equiv="X-UA-Compatible" content="IE=EDGE" />
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta charset="utf-8" />
  <link rel="stylesheet" type="text/css" href="/css/libraries.min.css" />
  <link rel="stylesheet" type="text/css" href="/css/index.min.css" />
  <link rel="stylesheet" type="text/css" href="/api/static/css/form.css" />

  <link rel="shortcut icon" href="/images/tutor-favicon.ico" />
  <link rel="icon" sizes="76x76" href="/images/apple-touch-icon-ipad-76x76.png" />
  <link rel="icon" sizes="152x152" href="/images/apple-touch-icon-ipad-retina-152x152.png" />
  <link rel="icon" sizes="60x60" href="/images/apple-touch-icon-iphone-60x60.png" />
  <link rel="icon" sizes="120x120" href="/images/apple-touch-icon-iphone-retina-120x120.png" />
  <link rel="apple-touch-icon" sizes="76x76" href="/images/apple-touch-icon-ipad-76x76.png" />
  <link rel="apple-touch-icon" sizes="152x152" href="/images/apple-touch-icon-ipad-retina-152x152.png" />
  <link rel="apple-touch-icon" sizes="60x60" href="/images/apple-touch-icon-iphone-60x60.png" />
  <link rel="apple-touch-icon" sizes="120x120" href="/images/apple-touch-icon-iphone-retina-120x120.png" />
</head>

<body>

  <main role="main" class="container">
    <h1 class="text-center"><a href="/"><img src="/images/logo.jpg" alt="Tutor web" /></a></h1>

    <section>
      % if not error is UNDEFINED:
        <h3>Error: ${error['type']}</h3>
        <p>${error['message']}</p>
        <pre>${error['stack']}</pre>
      % elif not warning is UNDEFINED:
        <h3>Error: ${warning['type']}</h3>
        <p>${warning['message']}</p>
        <pre>${warning['stack']}</pre>
      % elif not info is UNDEFINED:
        <h3>Error: ${info['type']}</h3>
        <p>${info['message']}</p>
        <pre>${info['stack']}</pre>
      % else:
        (unknown error level)
      % endif
    </section>

    <div class="status">
      <div id="tw-actions">
        <a href="/" class="button">Back to main menu</a>
      </div>
    </div>
  </main>
</body>
</html>
