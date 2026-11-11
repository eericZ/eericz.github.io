---
layout: page
title: Pages
description: All pages on this site.
listed: false
permalink: /pages/
---

{% assign listed_pages = site.pages | sort: "title" %}
<ul>
  {% for listed_page in listed_pages %}
    {% if listed_page.title and listed_page.url contains "/pages/" and listed_page.url != "/pages/" and listed_page.listed != false %}
      <li><a href="{{ listed_page.url | relative_url }}">{{ listed_page.title | escape }}</a>{% if listed_page.description %} - {{ listed_page.description | escape }}{% endif %}</li>
    {% endif %}
  {% endfor %}
</ul>
