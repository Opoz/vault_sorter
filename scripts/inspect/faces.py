import os,sys,subprocess
PROFILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'profile.mjs')
f=sys.argv[1]; deg=sys.argv[2] if len(sys.argv)>2 else '0'
for side in ['-x','+x','-y','+y','-z','+z']:
  out=subprocess.run(['node',PROFILE,f,side,'2',deg],capture_output=True,text=True).stdout.split('\n')
  out=[l for l in out if not l.startswith('turned')]; b=''.join(out[1:])
  tot=len(b) or 1
  print('  %s: solid(.)=%3.0f%% shallow(1-4)=%3.0f%% mid(5-8)=%3.0f%% deep(#)=%3.0f%% empty=%3.0f%%  %s'%(side,100*b.count('.')/tot,100*sum(b.count(c) for c in '1234')/tot,100*sum(b.count(c) for c in '5678')/tot,100*b.count('#')/tot,100*b.count(' ')/tot,out[0][:50]))
