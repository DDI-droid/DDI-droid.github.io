---
layout: default
permalink: /blog/
title: blog
nav: true
nav_order: 1
pagination:
  enabled: true
  collection: posts
  permalink: /page/:num/
  per_page: 5
  sort_field: date
  sort_reverse: true
  trail:
    before: 1 # The number of links before the current page
    after: 3 # The number of links after the current page
---

<style>
  .blog-index {
    --blog-accent: #3b7066;
    --blog-accent-soft: rgba(59, 112, 102, 0.08);
    --blog-rule: rgba(35, 45, 42, 0.14);
  }

  :root[data-theme="dark"] .blog-index {
    --blog-accent: #a3c7bb;
    --blog-accent-soft: rgba(163, 199, 187, 0.1);
    --blog-rule: rgba(255, 255, 255, 0.16);
  }

  .blog-index .blog-masthead {
    margin-bottom: 1.8rem;
    padding: 0.6rem 0 1.5rem;
    border-bottom: 1px solid var(--blog-rule);
  }

  .blog-index .blog-kicker {
    margin: 0 0 0.55rem;
    color: var(--blog-accent);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .blog-index .blog-masthead h1 {
    margin: 0;
    padding: 0;
    color: var(--global-text-color);
    font-family: Georgia, "Times New Roman", serif;
    font-size: clamp(2.7rem, 6vw, 4rem);
    font-weight: 500;
    letter-spacing: -0.04em;
    line-height: 1.05;
  }

  .blog-index .blog-deck {
    max-width: 42rem;
    margin: 0.8rem 0 0;
    color: var(--global-text-color);
    font-size: 0.98rem;
    line-height: 1.6;
    opacity: 0.76;
  }

  .blog-index .blog-layout {
    display: grid;
    grid-template-columns: minmax(150px, 185px) minmax(0, 1fr);
    gap: clamp(1.6rem, 4vw, 3.2rem);
    align-items: start;
  }

  .blog-index .blog-topic-index {
    position: sticky;
    top: 5.5rem;
    align-self: start;
    padding: 0.3rem 1.15rem 1rem 0;
    border-right: 1px solid var(--blog-rule);
  }

  .blog-index .blog-topic-index h2 {
    margin: 0 0 0.8rem;
    color: var(--global-text-color);
    font-size: 0.82rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .blog-index .blog-topic-list {
    display: grid;
    gap: 0.12rem;
  }

  .blog-index .blog-topic-link {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-left: -0.55rem;
    padding: 0.46rem 0.55rem;
    border-left: 2px solid transparent;
    border-radius: 0 0.35rem 0.35rem 0;
    color: var(--global-text-color);
    font-size: 0.86rem;
    line-height: 1.3;
    text-decoration: none !important;
    transition: background-color 150ms ease, color 150ms ease;
  }

  .blog-index .blog-topic-link:hover,
  .blog-index .blog-topic-link.is-current {
    border-left-color: var(--blog-accent);
    background: var(--blog-accent-soft);
    color: var(--blog-accent);
  }

  .blog-index .blog-topic-link.is-current {
    font-weight: 650;
  }

  .blog-index .blog-topic-link:focus-visible,
  .blog-index .post-list .post-title:focus-visible,
  .blog-index .post-list .post-tags a:focus-visible {
    outline: 2px solid var(--blog-accent);
    outline-offset: 2px;
  }

  .blog-index .blog-topic-count {
    color: var(--global-text-color);
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
    opacity: 0.58;
  }

  .blog-index .blog-main {
    min-width: 0;
  }

  .blog-index .blog-feed-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    margin: 0 0 0.25rem;
    padding: 0 0 0.7rem;
    border-bottom: 1px solid var(--blog-rule);
  }

  .blog-index .blog-feed-heading h2 {
    margin: 0;
    color: var(--global-text-color);
    font-family: Georgia, "Times New Roman", serif;
    font-size: 1.35rem;
    font-weight: 500;
  }

  .blog-index .blog-post-count {
    color: var(--global-text-color);
    font-size: 0.74rem;
    opacity: 0.62;
  }

  .blog-index .post-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .blog-index .post-list > li {
    margin: 0;
    padding: 1.25rem 0 1.4rem;
    border-bottom: 1px solid var(--blog-rule);
  }

  .blog-index .post-list > li:first-child {
    padding-top: 0.8rem;
  }

  .blog-index .post-list h3 {
    margin: 0 0 0.45rem;
    line-height: 1.25;
  }

  .blog-index .post-list .post-title {
    color: var(--global-text-color);
    font-family: Georgia, "Times New Roman", serif;
    font-size: clamp(1.25rem, 2vw, 1.55rem);
    font-weight: 500;
    line-height: 1.25;
    text-decoration: none;
  }

  .blog-index .post-list .post-title:hover {
    color: var(--blog-accent);
    text-decoration: underline;
    text-decoration-color: var(--blog-accent);
    text-underline-offset: 0.16em;
  }

  .blog-index .post-list li > p:not(.post-meta):not(.post-tags) {
    margin: 0.4rem 0 0.55rem;
    color: var(--global-text-color);
    font-size: 0.94rem;
    line-height: 1.6;
    opacity: 0.84;
  }

  .blog-index .post-list .post-meta {
    margin: 0.55rem 0 0.4rem;
    color: var(--global-text-color);
    font-size: 0.76rem;
    opacity: 0.62;
  }

  .blog-index .post-list .post-tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    margin: 0;
    font-size: 0.72rem;
  }

  .blog-index .post-list .post-tags a {
    padding: 0.12rem 0.48rem;
    border: 1px solid var(--blog-rule);
    border-radius: 999px;
    color: var(--global-text-color);
    text-decoration: none;
    opacity: 0.74;
  }

  .blog-index .post-list .post-tags a:hover {
    border-color: var(--blog-accent);
    color: var(--blog-accent);
    opacity: 1;
  }

  .blog-index .post-list li.featured-post {
    margin: 0.65rem 0 0;
    padding: 1.15rem 1rem 1.2rem;
    border: 0;
    border-left: 3px solid var(--blog-accent);
    border-radius: 0 0.45rem 0.45rem 0;
    background: var(--blog-accent-soft);
  }

  .blog-index .post-list li.featured-post h3::before {
    display: block;
    margin-bottom: 0.45rem;
    color: var(--blog-accent);
    content: "Featured";
    font-family: sans-serif;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  @media (max-width: 760px) {
    .blog-index .blog-layout {
      grid-template-columns: minmax(0, 1fr);
      gap: 1.1rem;
    }

    .blog-index .blog-topic-index {
      position: static;
      padding: 0 0 0.7rem;
      border-right: 0;
      border-bottom: 1px solid var(--blog-rule);
    }

    .blog-index .blog-topic-index h2 {
      margin-bottom: 0.4rem;
    }

    .blog-index .blog-topic-list {
      display: flex;
      gap: 0.2rem;
      overflow-x: auto;
      padding: 0.1rem 0.1rem 0.35rem;
      scrollbar-width: thin;
    }

    .blog-index .blog-topic-link {
      flex: 0 0 auto;
      margin: 0;
      padding: 0.45rem 0.55rem;
      border: 0;
      border-bottom: 2px solid transparent;
      border-radius: 0;
    }

    .blog-index .blog-topic-link:hover,
    .blog-index .blog-topic-link.is-current {
      border-bottom-color: var(--blog-accent);
      border-left-color: transparent;
    }
  }
</style>

<div class="post blog-index">
  {% assign blog_name_size = site.blog_name | size %}
  {% assign blog_description_size = site.blog_description | size %}
  <header class="blog-masthead">
    {% if blog_name_size > 0 %}
      <h1>{{ site.blog_name }}</h1>
    {% endif %}
    {% if blog_description_size > 0 %}
      <p class="blog-deck">{{ site.blog_description }}</p>
    {% endif %}
  </header>

  <div class="blog-layout">
    <aside class="blog-topic-index" aria-label="Topics">
      <p class="blog-kicker">Browse</p>
      <h2>Topics</h2>
      <nav class="blog-topic-list" aria-label="Filter posts by topic">
        <a class="blog-topic-link is-current" href="{{ '/blog/' | relative_url }}" aria-current="page">
          <span>All posts</span>
          <span class="blog-topic-count">{{ site.posts.size }}</span>
        </a>
        {% assign sorted_topics = site.tags | sort %}
        {% for topic in sorted_topics %}
          {% assign topic_label = topic[0] | replace: '-', ' ' | capitalize %}
          {% if topic[0] == 'llm' %}{% assign topic_label = 'LLM' %}{% endif %}
          {% if topic[0] == 'ocr' %}{% assign topic_label = 'OCR' %}{% endif %}
          {% if topic[0] == 'rl' %}{% assign topic_label = 'RL' %}{% endif %}
          {% if topic[0] == 'meta-reasoning' %}{% assign topic_label = 'Meta-reasoning' %}{% endif %}
          <a class="blog-topic-link" href="{{ topic[0] | slugify | prepend: '/blog/tag/' | relative_url }}">
            <span>{{ topic_label }}</span>
            <span class="blog-topic-count">{{ topic[1].size }}</span>
          </a>
        {% endfor %}
      </nav>
    </aside>

    <section class="blog-main" aria-label="Latest posts">
      <div class="blog-feed-heading">
        <h2>Latest</h2>
        <span class="blog-post-count">{{ site.posts.size }} posts</span>
      </div>



{% assign featured_posts = site.posts | where: "featured", "true" %}
{% if featured_posts.size > 0 %}
<br>

<div class="container featured-posts">
{% assign is_even = featured_posts.size | modulo: 2 %}
<div class="row row-cols-{% if featured_posts.size <= 2 or is_even == 0 %}2{% else %}3{% endif %}">
{% for post in featured_posts %}
<div class="col mb-4">
<a href="{{ post.url | relative_url }}">
<div class="card hoverable">
<div class="row g-0">
<div class="col-md-12">
<div class="card-body">
<div class="float-right">
<i class="fa-solid fa-thumbtack fa-xs"></i>
</div>
<h3 class="card-title text-lowercase">{{ post.title }}</h3>
<p class="card-text">{{ post.description }}</p>

                    {% if post.external_source == blank %}
                      {% assign read_time = post.content | number_of_words | divided_by: 180 | plus: 1 %}
                    {% else %}
                      {% assign read_time = post.feed_content | strip_html | number_of_words | divided_by: 180 | plus: 1 %}
                    {% endif %}
                    {% assign year = post.date | date: "%Y" %}

                    <p class="post-meta">
                      {{ read_time }} min read &nbsp; &middot; &nbsp;
                      <a href="{{ year | prepend: '/blog/' | relative_url }}">
                        <i class="fa-solid fa-calendar fa-sm"></i> {{ year }} </a>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </a>
        </div>
      {% endfor %}
      </div>
    </div>
    <hr>

{% endif %}

  <ul class="post-list">

    {% if page.pagination.enabled %}
      {% assign postlist = paginator.posts %}
    {% else %}
      {% assign postlist = site.posts %}
    {% endif %}

    {% for post in postlist %}

    {% if post.external_source == blank %}
      {% assign read_time = post.content | number_of_words | divided_by: 180 | plus: 1 %}
    {% else %}
      {% assign read_time = post.feed_content | strip_html | number_of_words | divided_by: 180 | plus: 1 %}
    {% endif %}
    {% assign year = post.date | date: "%Y" %}
    {% assign tags = post.tags | join: "" %}
    {% assign categories = post.categories | join: "" %}

    <li class="{% if post.highlight %}featured-post{% endif %}">

{% if post.thumbnail %}

<div class="row">
          <div class="col-sm-9">
{% endif %}
        <h3>
        {% if post.redirect == blank %}
          <a class="post-title" href="{{ post.url | relative_url }}">{{ post.title }}</a>
        {% elsif post.redirect contains '://' %}
          <a class="post-title" href="{{ post.redirect }}" target="_blank">{{ post.title }}</a>
          <svg width="2rem" height="2rem" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
            <path d="M17 13.5v6H5v-12h6m3-3h6v6m0-6-9 9" class="icon_svg-stroke" stroke="#999" stroke-width="1.5" fill="none" fill-rule="evenodd" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        {% else %}
          <a class="post-title" href="{{ post.redirect | relative_url }}">{{ post.title }}</a>
        {% endif %}
      </h3>
      <p>{{ post.description }}</p>
      <p class="post-meta">
        {{ read_time }} min read &nbsp; &middot; &nbsp;
        {{ post.date | date: '%B %d, %Y' }}
        {% if post.external_source %}
        &nbsp; &middot; &nbsp; {{ post.external_source }}
        {% endif %}
      </p>
      <p class="post-tags">
        <a href="{{ year | prepend: '/blog/' | relative_url }}">{{ year }}</a>
        {% if tags != "" %}
          {% for tag in post.tags %}
            <a href="{{ tag | slugify | prepend: '/blog/tag/' | relative_url }}">{{ tag | replace: '-', ' ' }}</a>
          {% endfor %}
        {% endif %}
        {% if categories != "" %}
          {% for category in post.categories %}
            <a href="{{ category | slugify | prepend: '/blog/category/' | relative_url }}">{{ category }}</a>
          {% endfor %}
        {% endif %}
      </p>

{% if post.thumbnail %}

</div>

  <div class="col-sm-3">
    <img class="card-img" src="{{ post.thumbnail | relative_url }}" style="object-fit: cover; height: 90%" alt="image">
  </div>
</div>
{% endif %}
    </li>

    {% endfor %}

  </ul>

{% if page.pagination.enabled %}
{% include pagination.liquid %}
{% endif %}
    </section>
  </div>
</div>
