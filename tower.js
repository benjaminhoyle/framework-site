const ModuleStack = () => {
    const [moduleCount, setModuleCount] = React.useState(1);
    const [modules, setModules] = React.useState(['A']);

    const MODULE_TYPES = {
        A: { label: 'Base Module (Type A)' },
        B: { label: 'Type B' },
        C: { label: 'Type C' },
        D: { label: 'Type D' },
    };

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

    return (
        <div>
            <div className="module-selector">
                <select value={moduleCount} onChange={handleCountChange}>
                    {[...Array(8)].map((_, i) => (
                        <option key={i} value={i + 1}>{i + 1}</option>
                    ))}
                </select>
            </div>
            <div>
                {modules.map((type, index) => (
                    <div
                        key={index}
                        className={`module module-${type}`}
                    >
                        {index === 0 ? (
                            MODULE_TYPES[type].label
                        ) : (
                            <button 
                                className="module-button"
                                onClick={() => handleModuleTypeChange(index)}
                            >
                                {MODULE_TYPES[type].label}
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

ReactDOM.render(<ModuleStack />, document.getElementById('tower-app'));