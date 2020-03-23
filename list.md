## Pages on hikalium.com

<ul>
{% for page in site.pages %}
{% assign ext3 = page.url | slice: -4, 4 %}
{%   if ext3 == ".css" %}
{%     continue %}
{%   endif %}
{%   if page.title == nil %}
{%     continue %}
{%   endif %}
<li><a href="{{ page.url | relative_url }}">
{{ page.title }}
</a> {{page.description}}</li>
{% endfor %}
</ul>
