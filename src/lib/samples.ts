import list from '../../public/samples/index.json';
import ok from '../../public/samples/soft-ok.svg?raw';
import cat from '../../public/samples/cat-cute.svg?raw';
import coffee from '../../public/samples/work-coffee.svg?raw';
import wow from '../../public/samples/wow.svg?raw';
import sorry from '../../public/samples/sorry.svg?raw';
import done from '../../public/samples/done.svg?raw';

const images: Record<string, string> = { 'soft-ok.svg': ok, 'cat-cute.svg': cat, 'work-coffee.svg': coffee, 'wow.svg': wow, 'sorry.svg': sorry, 'done.svg': done };
export const samples = list.map((item) => ({ ...item, svg: images[item.file] }));
