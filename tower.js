const MODULE_TYPES = {
    A: { label: 'Base Unit', image: 'tower-images/type-a.jpeg' },
    B: { label: 'Short Extension', image: 'tower-images/type-b.jpeg' },
    C: { label: 'Long Extension', image: 'tower-images/type-c.jpeg' },
    D: { label: 'Double Extension', image: 'tower-images/type-d.jpeg' },
};

const PERSON_IMAGE = { src: 'tower-images/person.jpeg' };

const PRICING = {
    A: { name: "Base Unit", price: 5000 },
    B: { name: "Short Extension", price: 4000 },
    C: { name: "Long Extension", price: 4500 },
    D: { name: "Double Extension", price: 5500 },
};

const calculatePricing = (modules) => {
    let total = 0;
    const breakdown = modules.reduce((acc, type) => {
        const count = acc[type] ? acc[type].count + 1 : 1;
        const { name, price } = PRICING[type];
        total += price * count;
        return { ...acc, [type]: { count, name, price } };
    }, {});

    const breakdownLines = Object.entries(breakdown)
        .map(([type, { count, name, price }]) => `${count} x ${name} @ Ksh ${price.toLocaleString()}`);

    return {
        lines: breakdownLines,
        total: `Ksh ${total.toLocaleString()}`
    };
};

const ModuleStack = () => {
    const [moduleCount, setModuleCount] = React.useState(1);
    const [modules, setModules] = React.useState(['A']);
    const [pricingInfo, setPricingInfo] = React.useState({ lines: [], total: "" });
    const [imageDimensions, setImageDimensions] = React.useState({});

    React.useEffect(() => {
        const loadImage = (src) => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve({ src, width: img.width, height: img.height });
                img.onerror = reject;
                img.src = src;
            });
        };

        const loadAllImages = async () => {
            const modulePromises = Object.values(MODULE_TYPES).map(module => loadImage(module.image));
            const personPromise = loadImage(PERSON_IMAGE.src);
            
            try {
                const moduleResults = await Promise.all(modulePromises);
                const personResult = await personPromise;
                
                const dimensions = {};
                moduleResults.forEach(result => {
                    dimensions[result.src] = { width: result.width, height: result.height };
                });
                dimensions[personResult.src] = { width: personResult.width, height: personResult.height };
                
                setImageDimensions(dimensions);
            } catch (error) {
                console.error("Error loading images:", error);
            }
        };

        loadAllImages();
    }, []);

    React.useEffect(() => {
        setPricingInfo(calculatePricing(modules));
    }, [modules]);

    const handleCountChange = (event) => {
        const value = parseInt(event.target.value);
        setModuleCount(value);
        setModules(prev => {
            const newModules = ['A']; // Always start with the base unit
            if (value > 1) {
                newModules.push(...Array(value - 1).fill('B'));
            }
            return newModules;
        });
    };

    const handleModuleTypeChange = (index) => {
        if (index === 0) return; // Prevent changing the base module
        const currentType = modules[index];
        const types = ['B', 'C', 'D'];
        const nextTypeIndex = (types.indexOf(currentType) + 1) % types.length;
        const nextType = types[nextTypeIndex];
        
        setModules(prev => {
            const newModules = [...prev];
            newModules[index] = nextType;
            return newModules;
        });
    };

    const renderModuleStack = (includeArrows = true, isClickable = true) => {
        return modules.map((type, index) => {
            const moduleElement = React.createElement('div', {
                key: `module-${index}`,
                className: `module module-${type}`,
                onClick: isClickable && index !== 0 ? () => handleModuleTypeChange(index) : undefined
            },
                React.createElement('img', { 
                    src: MODULE_TYPES[type].image, 
                    alt: MODULE_TYPES[type].label
                })
            );

            if (includeArrows && index < modules.length - 1) {
                return [
                    moduleElement,
                    React.createElement('div', { key: `arrow-${index}`, className: 'module-arrow' },
                        React.createElement('img', { src: 'tower-images/arrows.jpeg', alt: 'Arrow' })
                    )
                ];
            }

            return moduleElement;
        });
    };

    const calculateWidths = () => {
        if (Object.keys(imageDimensions).length === 0) return { shelfPercentage: 0, personPercentage: 0 };

        // Use the width of a single module (they should all be the same width)
        const moduleWidth = imageDimensions[MODULE_TYPES.A.image].width;
        const personWidth = imageDimensions[PERSON_IMAGE.src].width;

        const totalWidth = moduleWidth + personWidth;
        const shelfPercentage = (moduleWidth / totalWidth) * 100;
        const personPercentage = (personWidth / totalWidth) * 100;

        return { shelfPercentage, personPercentage };
    };

    const { shelfPercentage, personPercentage } = calculateWidths();

    return React.createElement('div', null, 
        React.createElement('div', { className: 'module-selector' },
            React.createElement('label', { htmlFor: 'module-count' }, 'Select number of units you would like, then tap to modify the design. Scroll down to see your finished bookshef.\n'),
            React.createElement('select', { id: 'module-count', value: moduleCount, onChange: handleCountChange },
                [...Array(8)].map((_, i) => 
                    React.createElement('option', { key: i, value: i + 1 }, i + 1)
                )
            )
        ),
        React.createElement('div', { className: 'module-stack' },
            renderModuleStack()
        ),
        React.createElement('div', { className: 'pricing-info' },
            ...pricingInfo.lines.map((line, index) => 
                React.createElement('div', { key: index }, 
                    line,
                    index < pricingInfo.lines.length - 1 ? React.createElement('span', null, ' +') : null
                )
            ),
            React.createElement('div', { className: 'pricing-total' }, '= ' + pricingInfo.total)
        ),
        React.createElement('div', { className: 'spacer' }),
        React.createElement('h1', { className: 'your-shelf-title' }, '2. See your shelf'),
        React.createElement('div', { className: 'shelf-display', style: { display: 'flex' } },
            React.createElement('div', { className: 'shelf-stack', style: { width: `${shelfPercentage}%` } },
                renderModuleStack(false, false).reverse() // Reverse the order here
            ),
            React.createElement('div', { className: 'person-image', style: { width: `${personPercentage}%` } },
                React.createElement('img', { src: PERSON_IMAGE.src, alt: 'Person' })
            )
        )
    );
};

ReactDOM.render(React.createElement(ModuleStack), document.getElementById('tower-app'));