"""Transparent, static Manim illustration for the New Beginnings draft."""
from pathlib import Path

from manim import *


INK = "#15171B"
MUTED = "#737B86"
BORDER = "#D9DEE5"
PAPER = "#FCFCFB"
INPUT_GRAY = "#E8EAED"
BLUE = "#77B7D8"
TEAL = "#76C7B6"
GOLD = "#E8BE71"
LILAC = "#BCA7E8"


class QueryOracleCode(Scene):
    def construct(self):
        # Transparent canvas. The post background shows through around the three objects.
        self.camera.background_opacity = 0

        # Keep the gray outer query box, with one thin gray line inside and no text.
        query = RoundedRectangle(
            width=2.82,
            height=0.56,
            corner_radius=0.13,
            stroke_color=BORDER,
            stroke_width=2.2,
            fill_color=INPUT_GRAY,
            fill_opacity=1,
        ).move_to(LEFT * 4.15)
        query_line = Line(
            query.get_center() + LEFT * 1.05,
            query.get_center() + RIGHT * 1.05,
            color=MUTED,
            stroke_width=4.5,
            cap_style=CapStyleType.ROUND,
        )

        # The oracle is phi in an elongated box. Its only label sits below the box.
        oracle = RoundedRectangle(
            width=2.48,
            height=1.52,
            corner_radius=0.16,
            stroke_color=INK,
            stroke_width=1,
            fill_color=INK,
            fill_opacity=1,
        )
        phi = Text("φ", font="Arial", font_size=100, color=WHITE).move_to(oracle.get_center())
        oracle_group = VGroup(oracle, phi)
        oracle_label = Text(
            "Oracle", font="Arial", weight="BOLD", font_size=18, color=MUTED
        ).next_to(oracle, DOWN, buff=0.18)
        query_label = Text(
            "Query", font="Arial", weight="BOLD", font_size=18, color=MUTED
        ).move_to([query.get_center()[0], oracle_label.get_center()[1], 0])

        # The SVG itself fills the former outer card's exact footprint; no dark backdrop.
        generated_code = SVGMobject(str(Path(__file__).with_name("script-icon.svg")))
        generated_code.stretch_to_fit_width(2.72)
        generated_code.stretch_to_fit_height(1.52)
        generated_code.move_to(RIGHT * 4.15)
        code_label = Text(
            "Code/Target", font="Arial", weight="BOLD", font_size=18, color=MUTED
        ).next_to(generated_code, DOWN, buff=0.18)

        input_arrow = Arrow(
            query.get_right() + RIGHT * 0.14,
            oracle.get_left() + LEFT * 0.14,
            buff=0,
            color="#8C96A2",
            stroke_width=3.2,
            max_tip_length_to_length_ratio=0.22,
        )
        output_arrow = Arrow(
            oracle.get_right() + RIGHT * 0.14,
            generated_code.get_left() + LEFT * 0.14,
            buff=0,
            color="#8C96A2",
            stroke_width=3.2,
            max_tip_length_to_length_ratio=0.22,
        )

        self.add(
            query,
            query_line,
            query_label,
            input_arrow,
            oracle_group,
            oracle_label,
            output_arrow,
            generated_code,
            code_label,
        )
