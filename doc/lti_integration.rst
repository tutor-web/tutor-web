Tutor-web as LTI
****************

Tutor-web can be used as an LTI-compliant app within another LCMS, e.g. Canvas. This offers:

* Single-sign-on: A student logged into Canvas will be automatically registered / signed into tutor-web
* Grade upload: If tutor-web is added as an *assignment* (rather than module), then student grades will be automatically reported back to Canvas

Configuring Canvas to use Tutor-web
===================================

You will need a **consumer_key** and **shared_secret** setup in tutor-web

If you have enough privileges you can add a new app to canvas, select the following options:

1. LTI version: ``1.1``
2. Configuration type: "By URL"
3. Name: ``Tutor-web``
4. Consumer key: **consumer_key**
5. Shared Secret: **shared_secret**
6. Config URL: ``https://beta.tutor-web.net/lti-tool-config.xml``

If "By URL" isn't an option, or you need to edit this one for whatever
reason, then change the following fields.

1. LTI version: ``1.1``
2. Consumer Key: **consumer_key**
3. Shared Secret: **shared_secret**
4. Launch URL: ``https://beta.tutor-web.net/``
5. Domain: ``beta.tutor-web.net``
6. Privacy: ``Public``

Adding as an assignment/module
==============================

Find the drill you wish to add, and copy the URL, which should begin with ``/stage``, for example::

    https://beta.tutor-web.net/stage?path=%2Fapi%2Fstage%3Fpath%3Dstats.101.209_verk.l01.stage0

Configuring Tutor-web
=====================

Consumer keys and corresponding secrets should be added to the ``APP_LTI_SECRETS`` variable in ``.local-conf``.
The format should be::

    APP_LTI_SECRETS=(consumer_key):(shared_secret),(consumer_key_2):(shared_secret_2),...
