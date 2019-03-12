## Welcome!

This is hikalium.com.

Do not attack this site. There is no flag at all ;)

<ul>
{% for page in site.pages %}
{% assign ext = page.url | slice: -4, 4 %}
{%   if ext != ".css" %}
<li><a href="{{ page.url }}">
{{ page.title }}
</a> {{page.description}}</li>
{% endif %}
{% endfor %}
</ul>
