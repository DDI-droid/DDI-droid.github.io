"""Original Manim teaching figures for the Context to Gating article.
Static, manually stepped builds: no autoplay, no TeX installation required.
Render all scenes with Windows writer .venv, cairo, --format=png -s -r 1600,900.
Copy images to assets/img/posts/context-to-gating using export_figures.py.
Colours encode query (blue), key (teal), value (amber), state (violet).
"""
from manim import *
config.background_color = '#F8F7F3'
INK='#172D3B'; MUTED='#536778'; BLUE='#2864AD'; TEAL='#137E78'; AMBER='#A66617'; PURPLE='#7954A1'; LINE='#CCD4D8'
FONT='Arial'
def text(s,size=25,color=INK): return Text(s,font=FONT,font_size=size,color=color)
def label(s,x,y,size=25,color=INK): return text(s,size,color).move_to([x,y,0])
def box(s,x,y,w=3.2,h=.8,color=BLUE,size=24):
    r=RoundedRectangle(width=w,height=h,corner_radius=.12,stroke_color=color,stroke_width=2,fill_color=WHITE,fill_opacity=1).move_to([x,y,0])
    t=label(s,x,y,size,color)
    if t.width>w-.25:t.scale_to_fit_width(w-.25)
    return VGroup(r,t)
def arrow(x1,y1,x2,y2,color=MUTED):return Arrow([x1,y1,0],[x2,y2,0],buff=.12,color=color,stroke_width=3,max_tip_length_to_length_ratio=.12)
def matrix(rows,cols,x,y,w=2.5,h=2.1,color=BLUE,highlight=None):
    group=VGroup()
    for i in range(rows):
        for j in range(cols):
            fill=color if highlight and highlight(i,j) else WHITE
            cell=Rectangle(width=w/cols,height=h/rows,stroke_color=color,stroke_width=1.8,fill_color=fill,fill_opacity=.24 if highlight and highlight(i,j) else 1).move_to([x-w/2+(j+.5)*w/cols,y+h/2-(i+.5)*h/rows,0])
            group.add(cell)
    return group
class TeachingScene(Scene):
    def heading(self,title,sub):
        self.add(label(title,0,3.6,36),label(sub,0,3.02,22,MUTED))
    def footer(self,s): self.add(label(s,0,-3.55,23,MUTED))
    def snap(self):
        # Explicit frame names make the rendered images deterministic and reusable.
        self.renderer.update_frame(self)
        self.renderer.get_frame()
        self.camera.get_image().save(str(self.out / f'{self.base}-{self.step}.png'))
        self.step+=1
    def begin(self,base):
        from pathlib import Path
        self.base=base;self.step=1
        self.out=Path(__file__).resolve().parents[2]/'assets'/'img'/'posts'/'context-to-gating'
        self.out.mkdir(parents=True,exist_ok=True)
class Tiling(TeachingScene):
    def construct(self):
        self.begin('tiling')
        for stage in range(4):
            self.clear();self.heading('Two concatenate axes. One sum axis.','A block multiplication is a grid of outputs, with a reduction inside each cell.')
            self.add(label('Q: N rows, d columns',-4.7,2.18,24,BLUE),label('K transpose: d rows, N columns',0,2.18,24,TEAL),label('Scores: N by N',4.7,2.18,24,PURPLE))
            self.add(matrix(4,4,-4.7,.8,color=BLUE,highlight=(lambda i,j:i==1) if stage>=1 else None),matrix(4,4,0,.8,color=TEAL,highlight=(lambda i,j:j==2) if stage>=1 else None),matrix(4,4,4.7,.8,color=PURPLE,highlight=(lambda i,j:i==1 and j==2) if stage>=1 else None))
            self.add(label('x',-2.35,.8,40),label('=',2.35,.8,40))
            if stage==0:
                self.add(label('Keep output rows and columns. Sum over the shared d dimension.',0,-1.15,27))
                self.footer('The conceptual 3D computation is not a 3D intermediate stored in HBM.')
            elif stage==1:
                self.add(label('A row strip times a column strip gives one output tile.',0,-1.15,27))
                self.add(label('Different output tiles are placed side by side or above / below.',0,-1.85,24))
                self.footer('These two axes concatenate: no addition between separate output regions.')
            else:
                self.add(box('Partial 1',-4,-1.65,w=2.3,color=BLUE),label('+',-2.45,-1.65,32),box('Partial 2',-.9,-1.65,w=2.3,color=TEAL),label('+',.65,-1.65,32),box('Partial 3',2.2,-1.65,w=2.3,color=AMBER),label('=',3.75,-1.65,32),box('Tile',5.15,-1.65,w=1.8,color=PURPLE))
                self.footer('Same output positions: SUM partial products along the third axis.' if stage==2 else 'Normal GEMM already accumulates these partial products on-chip before writing the tile.')
            self.snap()
class Traffic(TeachingScene):
    def construct(self):
        self.begin('traffic')
        for stage in range(3):
            self.clear();self.heading('Where does a completed score tile go?','FlashAttention changes the lifetime of the intermediate, not the meaning of attention.')
            if stage==0:
                self.add(box('Q, K tiles',-4.6,1.3,w=2.5),arrow(-3.25,1.3,-1.85,1.3),box('QK transpose',-.1,1.3,w=3.2,color=PURPLE),arrow(1.65,1.3,3.1,1.3),box('S in HBM',4.6,1.3,w=2.7,color=AMBER))
                self.add(box('Read S',-4.6,-.15,w=2.5,color=AMBER),arrow(-3.25,-.15,-1.85,-.15),box('Row softmax',-.1,-.15,w=3.2,color=PURPLE),arrow(1.65,-.15,3.1,-.15),box('P in HBM',4.6,-.15,w=2.7,color=AMBER))
                self.add(box('Read P, V',-4.6,-1.6,w=2.5,color=AMBER),arrow(-3.25,-1.6,-1.85,-1.6),box('PV',-.1,-1.6,w=3.2,color=PURPLE),arrow(1.65,-1.6,3.1,-1.6),box('Output',4.6,-1.6,w=2.7,color=TEAL))
                self.footer('Unfused pipeline: write S, read S, write P, read P. Each is N by N.')
            else:
                self.add(RoundedRectangle(width=12.4,height=3.8,corner_radius=.15,stroke_color=TEAL,fill_color=WHITE,fill_opacity=1).move_to([0,.1,0]))
                self.add(label('ON-CHIP WORKING SET',0,1.55,22,TEAL))
                self.add(box('Q, K, V tiles',-4.2,.35,w=2.7),arrow(-2.7,.35,-1.75,.35),box('Score tile',-.3,.35,w=2.6,color=PURPLE),arrow(1.15,.35,2.1,.35),box('Update m, l, U',3.9,.35,w=3,color=TEAL))
                self.add(label('Consume score tile immediately. Then discard it.',0,-.85,27))
                self.add(label('Next KV block -> rescale running statistics -> accumulate again',0,-2.4,24))
                self.footer('No full score/probability matrix in HBM. Inputs may still be loaded more than once.' if stage==1 else 'SRAM is local to each SM, not one GPU-wide pool. Registers and L2 are separate resources.')
            self.snap()
class Softmax(TeachingScene):
    def construct(self):
        self.begin('softmax')
        for stage in range(3):
            self.clear();self.heading('A softmax row can be merged in pieces','Example scores: 0, log(3), log(4). Values: 2, 6, 10.')
            self.add(box('Block A: weights 1, 3',-3.4,1.8,w=5.3,color=BLUE),box('Block B: weight 4',3.4,1.8,w=5.3,color=TEAL))
            if stage==0:
                self.add(label('A alone: total weight 4, weighted value 20',0,.65,29))
                self.add(label('A output = 20 / 4 = 5',0,-.2,32,BLUE))
                self.add(label('Do not add 5 to B output 10. Their denominators differ.',0,-1.35,25))
                self.footer('Keep a numerator AND a denominator, not just the normalized output.')
            elif stage==1:
                self.add(label('Stable A: m = log(3), l = 4/3, U = 20/3',0,.6,28,BLUE))
                self.add(label('New maximum = log(4). Rescale old l and U by 3/4.',0,-.3,26))
                self.add(label('l new = 1 + 1 = 2       U new = 5 + 10 = 15',0,-1.3,29,TEAL))
                self.footer('Subtracting a new maximum changes units. Rescale BOTH stored quantities.')
            else:
                self.add(label('Final output = U / l = 15 / 2 = 7.5',0,.65,32,PURPLE))
                self.add(label('Same result: (1 x 2 + 3 x 6 + 4 x 10) / 8',0,-.25,27))
                for i,(w,c) in enumerate([(1,BLUE),(3,BLUE),(4,TEAL)]):
                    self.add(Rectangle(width=w*1.1,height=.55,fill_color=c,fill_opacity=.8,stroke_width=0).move_to([-4.4+(sum([1,3,4][:i])+w/2)*1.1,-1.4,0]))
                self.footer('Exact in real arithmetic; floating-point reduction order can change the final bits.')
            self.snap()
class Memory(TeachingScene):
    def construct(self):
        self.begin('memory')
        for stage in range(3):
            self.clear();self.heading('Replace a growing list with a fixed matrix','S has value coordinates on rows, key coordinates on columns.')
            self.add(box('Value v: 3 numbers',-4.5,1.5,w=3.8,color=AMBER),box('Key k: 2 numbers',-.1,1.5,w=3.8,color=TEAL),label('outer product ->',3.7,1.5,25))
            self.add(matrix(3,2,4.8,-.1,w=2.2,h=2.2,color=PURPLE),label('S: 3 by 2',4.8,-1.6,25,PURPLE))
            if stage==0:
                self.add(label('Write: S <- S + v k transpose',-2.4,.1,30))
                self.add(label('Read: output numerator = S q',-2.4,-.8,27))
                self.footer('Every new token changes the same fixed-size matrix. No token list is retained.')
            elif stage==1:
                self.add(label('S q = sum of v_j (k_j dot q)',-2.1,.1,29))
                self.add(label('Each stored value returns in proportion to key similarity.',-1.4,-.9,22))
                self.footer('For positive kernel attention, divide by z dot q as well.')
            else:
                self.add(label('Two keys overlap -> their values interfere on a read.',-1.5,.15,26))
                self.add(label('A compressed state saves space but cannot store arbitrary history losslessly.',-1.35,-.9,21))
                self.footer('Feature choice, state dimension and task determine the quality/efficiency trade-off.')
            self.snap()
class Gates(TeachingScene):
    def construct(self):
        self.begin('gates')
        for stage in range(3):
            self.clear();self.heading('Forgetting is a product along time','Follow one old write; its surviving contribution depends on all intervening gates.')
            for row,(a,c) in enumerate([(.95,BLUE),(.2,AMBER)]):
                y=1.5-row*1.55
                self.add(label('key coordinate '+str(row+1),-5,y,23,c))
                for i in range(4):
                    x=-2.5+i*2.35
                    self.add(box(f'{a**i:.3f}',x,y,w=1.55,color=c,size=26))
                    if i<3:self.add(arrow(x+.8,y,x+1.5,y,c))
                self.add(label('gate = '+str(a),1.1,y-.6,21,MUTED))
            if stage==0:self.footer('Fixed decay: every step uses the same gate for a given coordinate or head.')
            elif stage==1:self.footer('Input-dependent decay: the token chooses the gates. Products need not be constant powers.')
            else:self.footer('GLA can gate key coordinates differently. It does NOT have to erase the whole state together.')
            self.snap()
class SSD(TeachingScene):
    def construct(self):
        self.begin('ssd')
        for stage in range(3):
            self.clear();self.heading('A recurrence and a masked matrix multiplication','Scalar transition: S_t = a_t S_(t-1) + v_t k_t transpose')
            vals=[[1,0,0,0],[.8,1,0,0],[.4,.5,1,0],[.36,.45,.9,1]]
            for i in range(4):
                for j in range(4):
                    x=-4+j*1.2;y=1.55-i*.82
                    self.add(Rectangle(width=1.2,height=.82,stroke_color=LINE,fill_color=TEAL if i>=j else WHITE,fill_opacity=.18 if i>=j else 1).move_to([x,y,0]))
                    self.add(label(f'{vals[i][j]:g}',x,y,25,TEAL if i>=j else MUTED))
            self.add(label('Decay mask L',-2.2,-1.6,25,TEAL))
            if stage==0:
                self.add(label('Gates: a2=.8, a3=.5, a4=.9',3.1,1.3,24))
                self.add(label('Entry (4,1) = .8 x .5 x .9',3.1,.3,24))
                self.add(label('= .36',3.1,-.5,30,TEAL))
                self.footer('Below-diagonal entries are products of the gates after each write.')
            else:
                self.add(label('Pairwise score matrix QK transpose',3.1,1.35,23,BLUE))
                self.add(label('Elementwise multiply by L',3.1,.4,25,TEAL))
                self.add(label('Then multiply by V',3.1,-.55,25,AMBER))
                self.footer('Same recurrence, another execution form. No softmax is implied.' if stage==1 else 'SSD exploits structured masks and scalar transitions; not every SSM equals every attention layer.')
            self.snap()
