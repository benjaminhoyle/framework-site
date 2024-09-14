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
        total += price;
        return { ...acc, [type]: { count, name, price } };
    }, {});

    const breakdownLines = Object.entries(breakdown)
        .map(([type, { count, name, price }]) => `${count} x ${name} @ Ksh ${price.toLocaleString()}`);

    return {
        lines: breakdownLines,
        total: `Total Cost: Ksh ${total.toLocaleString()}`
    };
};

const ModuleCountSelector = ({ modules, setModules }) => {
    const handleCountChange = (event) => {
        const value = parseInt(event.target.value);
        setModules(prev => {
            const newModules = ['A']; // Always start with the base unit
            if (value > 1) {
                newModules.push(...Array(value - 1).fill('B'));
            }
            return newModules;
        });
    };

    return React.createElement('div', { className: 'module-count-selector' },
        React.createElement('span', null, 'I want a shelf with'),
        React.createElement('select', {
            value: modules.length,
            onChange: handleCountChange,
            className: 'minimal-select'
        },
            [...Array(8)].map((_, i) => 
                React.createElement('option', { key: i, value: i + 1 }, i + 1)
            )
        ),
        React.createElement('span', null, 'parts')
    );
};

const Section = ({ title, content, children }) => {
    return React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'section-spacer' }),
        React.createElement('h1', { className: 'centered' }, title),
        React.createElement('div', { className: 'content-box' },
            React.createElement('p', null, content)
        ),
        React.createElement('div', { className: 'paragraph-spacer' }),
        children
    );
};

const BuildShelf = ({ modules, setModules }) => {
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

    const renderModuleStack = () => {
        return modules.map((type, index) => {
            const moduleElement = React.createElement('div', {
                key: `module-${index}`,
                className: `module module-${type}`,
                onClick: index !== 0 ? () => handleModuleTypeChange(index) : undefined
            },
                React.createElement('img', { 
                    src: MODULE_TYPES[type].image, 
                    alt: MODULE_TYPES[type].label
                })
            );

            if (index < modules.length - 1) {
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

    return React.createElement('div', { className: 'module-stack' },
        renderModuleStack()
    );
};

const ShelfPreview = ({ modules, imageDimensions }) => {
    const calculateWidths = () => {
        if (Object.keys(imageDimensions).length === 0) return { shelfPercentage: 0, personPercentage: 0 };

        const moduleWidth = imageDimensions[MODULE_TYPES.A.image].width;
        const personWidth = imageDimensions[PERSON_IMAGE.src].width;

        const totalWidth = moduleWidth + personWidth;
        const shelfPercentage = (moduleWidth / totalWidth) * 100;
        const personPercentage = (personWidth / totalWidth) * 100;

        return { shelfPercentage, personPercentage };
    };

    const { shelfPercentage, personPercentage } = calculateWidths();

    return React.createElement('div', { className: 'shelf-display', style: { display: 'flex' } },
        React.createElement('div', { className: 'shelf-stack', style: { width: `${shelfPercentage}%` } },
            modules.map((type, index) => 
                React.createElement('div', { key: `module-${index}`, className: `module module-${type}` },
                    React.createElement('img', { src: MODULE_TYPES[type].image, alt: MODULE_TYPES[type].label })
                )
            ).reverse()
        ),
        React.createElement('div', { className: 'person-image', style: { width: `${personPercentage}%` } },
            React.createElement('img', { src: PERSON_IMAGE.src, alt: 'Person' })
        )
    );
};

const WhatsAppButton = ({ pricingInfo }) => {
    const generateWhatsAppLink = () => {
        const message = `I'd like to place an order for:\n${pricingInfo.lines.join('\n')}\n${pricingInfo.total}`;
        const encodedMessage = encodeURIComponent(message);
        return `https://wa.me/254783891005?text=${encodedMessage}`;
    };

    return React.createElement('a', {
        href: generateWhatsAppLink(),
        className: 'whatsapp-button',
        target: '_blank',
        rel: 'noopener noreferrer'
    }, 'Place order via WhatsApp');
};

const ShelfCalculator = ({ modules }) => {
    const pricingInfo = React.useMemo(() => calculatePricing(modules), [modules]);

    return React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'pricing-info' },
            ...pricingInfo.lines.map((line, index) => 
                React.createElement('div', { key: index }, 
                    line,
                    index < pricingInfo.lines.length - 1 ? React.createElement('span', null, ' +') : null
                )
            ),
            React.createElement('div', { className: 'pricing-total' }, pricingInfo.total)
        ),
        React.createElement(WhatsAppButton, { pricingInfo })
    );
};

const App = () => {
    const [modules, setModules] = React.useState(['A']);
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

    return React.createElement(React.Fragment, null,
        React.createElement(Section, {
            title: "1. Build Your Shelf",
            content: "Select the number of parts for your shelf and customize the design by tapping on it."
        }, 
        React.createElement(ModuleCountSelector, { modules, setModules }),
        React.createElement(BuildShelf, { modules, setModules })),
        React.createElement(Section, {
            title: "2. See your shelf",
            content: "Here's a preview of your custom shelf design. The image shows how your shelf will look in proportion to an average person."
        }, React.createElement(ShelfPreview, { modules, imageDimensions })),
        React.createElement(Section, {
            title: "3. Order your shelf",
            content: "See the total cost of your shelf here, and click the button to send us your order details by WhatsApp."
        }, React.createElement(ShelfCalculator, { modules }))
    );
};

ReactDOM.render(React.createElement(App), document.getElementById('tower-app'));