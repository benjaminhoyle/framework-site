const MODULE_TYPES = {
    A: { label: 'Base Unit', image: 'tower-images/type-a.jpeg' },
    B: { label: 'Short Extension', image: 'tower-images/type-b.jpeg' },
    C: { label: 'Long Extension', image: 'tower-images/type-c.jpeg' },
    D: { label: 'Double Extension', image: 'tower-images/type-d.jpeg' },
};

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

    React.useEffect(() => {
        setPricingInfo(calculatePricing(modules));
    }, [modules]);

    const handleCountChange = (event) => {
        const value = parseInt(event.target.value);
        setModuleCount(value);
        setModules(prev => {
            const newModules = [...prev];
            if (value > prev.length) {
                newModules.push(...Array(value - prev.length).fill('B'));
            } else {
                newModules.splice(value);
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

    const renderModuleStack = () => {
        const stack = [];
        modules.forEach((type, index) => {
            if (index > 0) {
                stack.push(
                    React.createElement('div', { key: `arrow-${index}`, className: 'module-arrow' },
                        React.createElement('img', { src: 'tower-images/arrows.jpeg', alt: 'Arrow' })
                    )
                );
            }
            stack.push(
                React.createElement('div', {
                    key: `module-${index}`,
                    className: `module module-${type}`,
                    onClick: () => index !== 0 && handleModuleTypeChange(index)
                },
                    React.createElement('img', { 
                        src: MODULE_TYPES[type].image, 
                        alt: MODULE_TYPES[type].label
                    })
                )
            );
        });
        return stack;
    };

    return React.createElement('div', null, 
        React.createElement('div', { className: 'module-selector' },
            React.createElement('select', { value: moduleCount, onChange: handleCountChange },
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
        )
    );
};

ReactDOM.render(React.createElement(ModuleStack), document.getElementById('tower-app'));