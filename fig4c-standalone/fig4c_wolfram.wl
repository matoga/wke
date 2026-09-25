(* ::Package:: *)
(* Fig 4c analogue, redrawn in the Wolfram Language from out/fig4c.wl (written by fig4c.py).

   wolframscript -file fig4c_wolfram.wl [out_dir]      writes out_dir/fig4c_wolfram.pdf
   or, in a notebook: SetDirectory["<this folder>"]; Get["fig4c_wolfram.wl"]; fig4c   (the figure)

   Left: the binned WKE (filled: samples inside the box, l^3 <= V; open: all samples). Right: the same with the
   published points and the per-series WKE curves, coloured by na and dotted past the box ceiling.
   Guides: rate = (l/xi)^2/56 (solid, exponential growth with tau = 56 t_xi) and D = 3.4 (dashed). *)

outDir = If[Length[$ScriptCommandLine] > 1, $ScriptCommandLine[[2]],
  FileNameJoin[{If[$InputFileName =!= "", DirectoryName[$InputFileName], Directory[]], "out"}]];
data = Get[FileNameJoin[{outDir, "fig4c.wl"}]];

edge = RGBColor["#2b3f7f"]; fill = RGBColor["#c3cadb"]; grey = GrayLevel[0.55];
xMax = 2100; tau = 56; dGuide = data["guide__D"];
lsym = If[data["length"] === "ell", "\[ScriptL]", OverBar["\[ScriptL]"]];

series = Union[StringCases[Keys[data], StartOfString ~~ "s" ~~ d : DigitCharacter .. ~~ "__rate" ~~ EndOfString :> d]];
series = Flatten[series];
na = AssociationMap[data["s" <> # <> "__na_um2"] &, series];
{naMin, naMax} = {Min[na] 0.9, Max[na] 1.1};
viridis = Blend[{RGBColor[0.267, 0.005, 0.329], RGBColor[0.229, 0.322, 0.546], RGBColor[0.128, 0.567, 0.551],
     RGBColor[0.369, 0.789, 0.383], RGBColor[0.993, 0.906, 0.144]}, #] &;
colour[s_] := viridis[Rescale[Log[na[s]], Log[{naMin, naMax}]]];

points[key_] := Transpose[{data[key <> "__ell_over_xi_sq"], data[key <> "__rate"]}];
bars[key_, style_] := Module[{x = data[key <> "__ell_over_xi_sq"], y = data[key <> "__rate"], e = data[key <> "__rate_err"]},
  {style, Thickness[0.002], MapThread[Line[{{#1, #2 - #3}, {#1, #2 + #3}}] &, {x, y, e}]}];
hexes[key_, face_, stroke_, size_] := Module[{pts = points[key]},
  {EdgeForm[{stroke, AbsoluteThickness[1.2]}], face,
   Inset[Graphics[{EdgeForm[{stroke, AbsoluteThickness[1.2]}], face, RegularPolygon[{0, 0}, 1, 6]},
      ImageSize -> size], #] & /@ pts}];

curves = Table[
  With[{xy = points["s" <> s], c = data["s" <> s <> "__box_ceiling_ell_over_xi_sq"]},
   {{colour[s], Opacity[0.85], AbsoluteThickness[0.8], Line[Select[xy, #[[1]] <= c &]]},
    {colour[s], Opacity[0.85], AbsoluteThickness[0.8], Dashing[{0.004, 0.006}], Line[Select[xy, #[[1]] >= c &]]}}],
  {s, series}];

yTop = Max[5.5, 1.1 Max[data["wke_all__rate"] + data["wke_all__rate_err"],
     Max[Select[points["s" <> #], First[#] <= xMax &][[All, 2]]] & /@ series]];

guides = {{Black, AbsoluteThickness[1.2], Line[{{0, 0}, {xMax, xMax/tau}}]},
   {Black, AbsoluteThickness[1.2], Dashing[{0.02, 0.01}], Line[{{0, dGuide}, {xMax, dGuide}}]},
   Text[Style[Row[{Superscript[Row[{"(", lsym, "/\[Xi])"}], 2], "/", tau}], 9, FontFamily -> "Times"], {Min[0.12 xMax, 0.55 yTop tau], Min[0.12 xMax, 0.55 yTop tau]/tau}, {1.1, 0}],
   Text[Style["D = 3.4 \[HBar]/m", 9, FontFamily -> "Times"], {xMax, dGuide}, {1, -1.2}]};

wke = {bars["wke_all", edge], hexes["wke_all", White, edge, 9], bars["wke", edge], hexes["wke", fill, edge, 9]};
published = {bars["exp", grey], hexes["exp", White, grey, 8]};

frame[prims_, title_] := Graphics[prims, Frame -> True, AspectRatio -> 0.95, PlotRange -> {{-0.02 xMax, xMax}, {0, yTop}},
   FrameTicks -> {{Automatic, None}, {{0, 600, 1200, 1800}, None}}, FrameStyle -> Directive[Black, 11, FontFamily -> "Times"],
   FrameLabel -> {Superscript[Row[{"(", lsym, "/\[Xi])"}], 2], Row[{"(m/\[HBar]) d", Superscript[lsym, 2], "/dt"}]},
   PlotLabel -> Style[title, 10, FontFamily -> "Times"], ImageSize -> 360];

fig4c = Grid[{{
   frame[{guides, wke}, ToString[Length[series]] <> " series pooled at the measured times"],
   frame[{curves, published, guides, wke}, "with the published points and the WKE series"],
   BarLegend[{viridis[Rescale[#, Log10[{naMin, naMax}]]] &, Log10[{naMin, naMax}]}, LegendLabel -> Style["log\:2081\:2080 na (\[Micro]m\:207b\.b2)", 10, FontFamily -> "Times"]]
   }}, Spacings -> 2, Alignment -> Center];

If[$ScriptCommandLine =!= {},
  Export[FileNameJoin[{outDir, "fig4c_wolfram.pdf"}], fig4c];
  Print[FileNameJoin[{outDir, "fig4c_wolfram.pdf"}]]];
fig4c
