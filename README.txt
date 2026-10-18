BBA STUDY HUB — HTML/CSS/JavaScript demo
========================================

FILES
- index.html: public website
- style.css, site.js: public styling and resource catalogue
- admin.html: admin dashboard
- admin.css, admin.js: admin styling and content management
- privacy-policy.html, disclaimer.html: policy pages

HOW TO RUN
1. Extract the ZIP folder.
2. Open index.html in a modern browser.
3. Open admin.html to manage posts.
4. Create a post, select a category, add a description and optionally attach a PDF.
5. Return to index.html in the SAME browser on the SAME device to see the post and download its PDF.

IMPORTANT LIMITATION
This requested HTML/CSS/JS-only version is a front-end demo. It stores posts and PDF data in that browser's localStorage, so it is NOT a real multi-user/server-connected admin panel. It has no authentication and is not secure for public deployment. Browser data does not automatically sync across different devices, users or browsers. For a genuine website with secure admin login, server-side PDF uploads and shared public content, a backend such as PHP + MySQL or Node.js + a database is required. Do not store passwords or sensitive documents in this demo.
PDF limit: 2 MB per upload in this demo to reduce browser storage problems.
